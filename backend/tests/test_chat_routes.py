import logging
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event as sa_event
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import events
from app.channels.web import hash_token
from app.database import get_db
from app.events import CONVERSATION_CLOSED, Event, portal_topic, texter_topic
from app.main import app
from app.models import (
    Account,
    AccountRole,
    Channel,
    ClosedBy,
    Conversation,
    ConversationStatus,
    Message,
    Shift,
    Texter,
)
from app.services.messages import message_body
from app.services.pipeline import send_responder_message


@pytest.fixture
def responder(db: Session) -> Account:
    now = datetime.now(UTC)
    account = Account(
        email="chat-responder@unc.edu",
        display_name="Private responder name",
        password_hash="unused",
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.flush()
    db.add(Shift(account_id=account.id, started_at=now, last_heartbeat_at=now))
    db.commit()
    return account


@pytest.fixture
def chat_client(db: Session, responder: Account) -> Iterator[TestClient]:
    def override_db() -> Iterator[Session]:
        try:
            yield db
        finally:
            # A real get_db closes the session. Do not let a missing route commit
            # pass simply because the next request reuses the test's session.
            db.rollback()

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Event]]:
    sent: list[tuple[str, Event]] = []
    monkeypatch.setattr(events.event_bus, "publish", lambda topic, e: sent.append((topic, e)))
    return sent


def start_session(client: TestClient) -> dict[str, str]:
    response = client.post("/api/chat/sessions")
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_session_returns_a_token_and_stores_only_its_hash(
    chat_client: TestClient, db: Session
) -> None:
    response = chat_client.post("/api/chat/sessions")

    assert response.status_code == 201
    payload = response.json()
    assert set(payload) == {"token", "conversation_id"}
    assert payload["conversation_id"] is None
    token = payload["token"]
    assert len(token) == 43  # token_urlsafe(32)
    texter = db.scalars(select(Texter)).one()
    assert texter.channel == Channel.WEB
    assert texter.identity_hash == hash_token(token)
    assert texter.revoked_at is None
    assert token.encode() not in texter.identity_hash
    assert db.scalar(select(func.count()).select_from(Conversation)) == 0


def test_no_conversation_before_the_first_message(chat_client: TestClient) -> None:
    response = chat_client.get("/api/chat/conversation", headers=start_session(chat_client))

    assert response.status_code == 404
    assert response.json()["code"] == "no_conversation"


def test_first_message_opens_a_conversation_and_later_messages_join_it(
    chat_client: TestClient, db: Session, responder: Account
) -> None:
    headers = start_session(chat_client)
    first = chat_client.post("/api/chat/messages", headers=headers, json={"body": "  hello 🙂  "})
    second = chat_client.post("/api/chat/messages", headers=headers, json={"body": "still here"})

    assert first.status_code == second.status_code == 201
    assert first.json()["body"] == "hello 🙂"
    conversation = db.scalars(select(Conversation)).one()
    assert conversation.status == ConversationStatus.ACTIVE
    assert conversation.assigned_account_id == responder.id
    assert conversation.message_count == 2
    message = db.get(Message, uuid.UUID(first.json()["id"]))
    assert message is not None
    assert message_body(message) == "hello 🙂"
    assert "hello 🙂".encode() not in message.body_ciphertext
    response = chat_client.get("/api/chat/conversation", headers=headers)
    assert response.status_code == 200
    assert response.json() == {
        "id": str(conversation.id),
        "status": "active",
        "messages": [first.json(), second.json()],
    }


def test_after_uses_message_time_instead_of_uuid_order(
    chat_client: TestClient, db: Session
) -> None:
    headers = start_session(chat_client)
    for body in ("first", "second", "third"):
        assert (
            chat_client.post("/api/chat/messages", headers=headers, json={"body": body}).status_code
            == 201
        )
    messages = db.scalars(select(Message).order_by(Message.created_at)).all()
    now = datetime.now(UTC)
    for index, message in enumerate(messages):
        message.id = uuid.UUID(int=100 - index)
        message.created_at = now + timedelta(seconds=index)
    db.commit()

    response = chat_client.get(
        "/api/chat/conversation", headers=headers, params={"after": str(messages[0].id)}
    )
    assert response.status_code == 200
    assert [m["body"] for m in response.json()["messages"]] == ["second", "third"]
    response = chat_client.get(
        "/api/chat/conversation", headers=headers, params={"after": str(messages[-1].id)}
    )
    assert response.status_code == 200
    assert response.json()["messages"] == []


def test_texters_cannot_read_each_others_conversations_or_cursors(chat_client: TestClient) -> None:
    first, second = start_session(chat_client), start_session(chat_client)
    private = chat_client.post("/api/chat/messages", headers=first, json={"body": "private"})
    assert private.status_code == 201
    assert (
        chat_client.get("/api/chat/conversation", headers=second).json()["code"]
        == "no_conversation"
    )
    own = chat_client.post("/api/chat/messages", headers=second, json={"body": "my own chat"})
    assert own.status_code == 201
    response = chat_client.get("/api/chat/conversation", headers=second)
    assert response.json()["messages"] == [own.json()]

    foreign = chat_client.get(
        "/api/chat/conversation", headers=second, params={"after": private.json()["id"]}
    )
    unknown = chat_client.get(
        "/api/chat/conversation", headers=second, params={"after": str(uuid.uuid4())}
    )
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json() == unknown.json()
    assert chat_client.post("/api/chat/conversation/end", headers=second).status_code == 204
    assert chat_client.get("/api/chat/conversation", headers=first).json()["messages"] == [
        private.json()
    ]


@pytest.mark.parametrize("authorization", [None, "", "Bearer", "Bearer unknown", "Basic unknown"])
@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/conversation"), ("POST", "/messages"), ("POST", "/conversation/end")],
)
def test_missing_or_invalid_tokens_return_401(
    chat_client: TestClient, authorization: str | None, method: str, path: str
) -> None:
    headers = {"Authorization": authorization} if authorization is not None else {}
    response = chat_client.request(method, f"/api/chat{path}", headers=headers, json={"body": "hi"})

    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


def test_token_in_query_or_cookie_does_not_authenticate(chat_client: TestClient) -> None:
    token = start_session(chat_client)["Authorization"].split()[1]
    chat_client.cookies.set("token", token)
    response = chat_client.get("/api/chat/conversation", params={"token": token})
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


def test_sms_identity_cannot_authenticate_as_a_web_texter(
    chat_client: TestClient, db: Session
) -> None:
    db.add(
        Texter(channel=Channel.SMS, identity_hash=hash_token("sms"), last_seen_at=datetime.now(UTC))
    )
    db.commit()

    response = chat_client.get("/api/chat/conversation", headers={"Authorization": "Bearer sms"})
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


def test_ending_closes_chat_revokes_token_and_publishes_after_commit(
    chat_client: TestClient, db: Session, responder: Account, published: list[tuple[str, Event]]
) -> None:
    headers = start_session(chat_client)
    assert (
        chat_client.post("/api/chat/messages", headers=headers, json={"body": "hi"}).status_code
        == 201
    )
    published.clear()
    before_commit: list[list[tuple[str, Event]]] = []

    def check_before_commit(session: Session) -> None:
        before_commit.append(list(published))

    sa_event.listen(db, "before_commit", check_before_commit)
    try:
        response = chat_client.post("/api/chat/conversation/end", headers=headers)
    finally:
        sa_event.remove(db, "before_commit", check_before_commit)

    assert response.status_code == 204
    assert response.content == b""
    assert before_commit == [[]]
    conversation = db.scalars(select(Conversation)).one()
    texter = db.scalars(select(Texter)).one()
    assert conversation.status == ConversationStatus.CLOSED
    assert conversation.closed_by == ClosedBy.TEXTER
    assert conversation.closed_at == texter.revoked_at
    assert texter.revoked_at is not None
    assert published == [
        (
            portal_topic(responder.id),
            {
                "type": CONVERSATION_CLOSED,
                "data": {"conversation_id": str(conversation.id), "closed_by": "texter"},
            },
        ),
        (
            texter_topic(texter.id),
            {
                "type": CONVERSATION_CLOSED,
                "data": {"conversation_id": str(conversation.id), "closed_by": "texter"},
            },
        ),
    ]
    for method, path in (
        ("GET", "/conversation"),
        ("POST", "/messages"),
        ("POST", "/conversation/end"),
    ):
        response = chat_client.request(
            method, f"/api/chat{path}", headers=headers, json={"body": "again"}
        )
        assert response.status_code == 401
        assert response.json()["code"] == "invalid_token"
    assert db.scalar(select(func.count()).select_from(Conversation)) == 1


def test_ending_before_any_message_still_revokes_the_token(
    chat_client: TestClient, db: Session
) -> None:
    headers = start_session(chat_client)
    assert chat_client.post("/api/chat/conversation/end", headers=headers).status_code == 204
    assert db.scalars(select(Texter)).one().revoked_at is not None
    assert chat_client.get("/api/chat/conversation", headers=headers).status_code == 401


@pytest.mark.parametrize("already_closed", [False, True])
def test_ending_an_unassigned_conversation(
    chat_client: TestClient, db: Session, published: list[tuple[str, Event]], already_closed: bool
) -> None:
    headers = start_session(chat_client)
    texter = db.scalars(select(Texter)).one()
    now = datetime.now(UTC)
    conversation = Conversation(
        texter_id=texter.id,
        channel=Channel.WEB,
        opened_at=now,
        status=ConversationStatus.CLOSED if already_closed else ConversationStatus.QUEUED,
        closed_by=ClosedBy.SYSTEM if already_closed else None,
        closed_at=now if already_closed else None,
    )
    db.add(conversation)
    db.commit()

    assert chat_client.post("/api/chat/conversation/end", headers=headers).status_code == 204
    assert conversation.status == ConversationStatus.CLOSED
    assert conversation.closed_by == (ClosedBy.SYSTEM if already_closed else ClosedBy.TEXTER)
    assert texter.revoked_at is not None
    data = {"closed_by": "texter"}
    if not already_closed:
        data["conversation_id"] = str(conversation.id)
    assert published == [(texter_topic(texter.id), {"type": CONVERSATION_CLOSED, "data": data})]


def test_failed_end_rolls_back_revocation_and_drops_the_close_event(
    chat_client: TestClient,
    db: Session,
    published: list[tuple[str, Event]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = start_session(chat_client)
    response = chat_client.post("/api/chat/messages", headers=headers, json={"body": "hi"})
    assert response.status_code == 201
    published.clear()

    def fail_commit() -> None:
        db.flush()
        raise RuntimeError("Simulated failed commit")

    with monkeypatch.context() as patch:
        patch.setattr(db, "commit", fail_commit)
        with pytest.raises(RuntimeError, match="Simulated failed commit"):
            chat_client.post("/api/chat/conversation/end", headers=headers)

    db.commit()
    assert published == []
    assert db.scalars(select(Texter)).one().revoked_at is None
    assert db.scalars(select(Conversation)).one().status == ConversationStatus.ACTIVE
    assert chat_client.get("/api/chat/conversation", headers=headers).status_code == 200


def test_responder_close_allows_a_new_conversation_with_the_same_texter(
    chat_client: TestClient, db: Session
) -> None:
    headers = start_session(chat_client)
    assert (
        chat_client.post("/api/chat/messages", headers=headers, json={"body": "hi"}).status_code
        == 201
    )
    first = db.scalars(select(Conversation)).one()
    first.status = ConversationStatus.CLOSED
    first.closed_by = ClosedBy.RESPONDER
    first.closed_at = datetime.now(UTC)
    db.commit()
    assert chat_client.get("/api/chat/conversation", headers=headers).json()["status"] == "closed"

    response = chat_client.post("/api/chat/messages", headers=headers, json={"body": "back again"})
    assert response.status_code == 201
    latest = chat_client.get("/api/chat/conversation", headers=headers).json()
    assert latest["id"] != str(first.id)
    assert latest["messages"] == [response.json()]
    assert db.scalar(select(func.count()).select_from(Texter)) == 1
    assert db.scalars(select(Texter)).one().revoked_at is None


@pytest.mark.parametrize("body", ["", " \n\t ", "x" * 2001, "  " + "x" * 2001 + "  "])
def test_invalid_message_lengths_return_422(
    chat_client: TestClient, db: Session, body: str
) -> None:
    response = chat_client.post(
        "/api/chat/messages", headers=start_session(chat_client), json={"body": body}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert db.scalar(select(func.count()).select_from(Message)) == 0


def test_maximum_message_length_is_checked_after_trimming(chat_client: TestClient) -> None:
    response = chat_client.post(
        "/api/chat/messages",
        headers=start_session(chat_client),
        json={"body": "  " + "x" * 2000 + "\n"},
    )
    assert response.status_code == 201
    assert response.json()["body"] == "x" * 2000


def test_session_limit_is_ten_per_hour_per_ip(chat_client: TestClient, db: Session) -> None:
    for _ in range(10):
        assert chat_client.post("/api/chat/sessions").status_code == 201
    response = chat_client.post("/api/chat/sessions")
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert 0 < int(response.headers["Retry-After"]) <= 3600
    assert db.scalar(select(func.count()).select_from(Texter)) == 10

    with TestClient(app, client=("203.0.113.8", 50000)) as other_ip:
        assert other_ip.post("/api/chat/sessions").status_code == 201


def test_message_limit_is_twenty_per_minute_per_token(chat_client: TestClient, db: Session) -> None:
    headers = start_session(chat_client)
    other = start_session(chat_client)
    for _ in range(20):
        assert (
            chat_client.post("/api/chat/messages", headers=headers, json={"body": "hi"}).status_code
            == 201
        )
    # Scheme spelling must not give the same token another bucket.
    headers["Authorization"] = headers["Authorization"].replace("Bearer", "bearer")
    response = chat_client.post("/api/chat/messages", headers=headers, json={"body": "blocked"})
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert 0 < int(response.headers["Retry-After"]) <= 60
    assert db.scalar(select(func.count()).select_from(Message)) == 20
    assert (
        chat_client.post("/api/chat/messages", headers=other, json={"body": "allowed"}).status_code
        == 201
    )
    assert chat_client.get("/api/chat/conversation", headers=headers).status_code == 200


def test_responses_expose_only_chat_fields(
    chat_client: TestClient, db: Session, responder: Account
) -> None:
    headers = start_session(chat_client)
    sent = chat_client.post("/api/chat/messages", headers=headers, json={"body": "hi"})
    assert set(sent.json()) == {"id", "sender", "body", "created_at"}
    conversation = db.scalars(select(Conversation)).one()
    send_responder_message(db, conversation, responder, "hello", datetime.now(UTC))
    db.commit()

    response = chat_client.get("/api/chat/conversation", headers=headers)
    payload = response.json()
    assert set(payload) == {"id", "status", "messages"}
    assert [m["sender"] for m in payload["messages"]] == ["texter", "responder"]
    assert all(set(m) == {"id", "sender", "body", "created_at"} for m in payload["messages"])
    texter = db.scalars(select(Texter)).one()
    for private in (
        str(texter.id),
        texter.identity_hash.hex(),
        responder.display_name,
        responder.email,
        str(responder.id),
    ):
        assert private not in response.text


def test_token_and_message_body_never_appear_in_application_logs(
    chat_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    headers = start_session(chat_client)
    body = "Distinct private student message"
    with caplog.at_level(logging.INFO, logger="app"):
        response = chat_client.post("/api/chat/messages", headers=headers, json={"body": body})
        assert response.status_code == 201
        assert chat_client.post("/api/chat/conversation/end", headers=headers).status_code == 204
    assert headers["Authorization"].split()[1] not in caplog.text
    assert body not in caplog.text
