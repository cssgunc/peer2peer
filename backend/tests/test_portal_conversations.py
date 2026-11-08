import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import events
from app.dependencies.auth import require_on_shift, require_staff
from app.events import (
    CONVERSATION_CLOSED,
    CONVERSATION_UPDATED,
    MESSAGE_CREATED,
    Event,
    portal_topic,
    texter_topic,
)
from app.main import app
from app.models import (
    Account,
    AccountRole,
    Channel,
    ClosedBy,
    Conversation,
    ConversationStatus,
    MessageSender,
    Texter,
)
from app.services.messages import add_message


@pytest.fixture
def account(db: Session) -> Account:
    account = Account(
        email="portal-test@unc.edu",
        display_name="Portal test responder",
        password_hash="unused-in-this-test",
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.flush()
    return account


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Event]]:
    sent: list[tuple[str, Event]] = []

    def record(topic: str, event: Event) -> None:
        sent.append((topic, event))

    monkeypatch.setattr(events.event_bus, "publish", record)
    return sent


def make_conversation_with_texter(
    db: Session, account: Account, now: datetime
) -> tuple[Texter, Conversation]:
    texter = Texter(
        channel=Channel.WEB,
        identity_hash=b"test-only-hash",
        last_seen_at=now,
    )
    db.add(texter)
    db.flush()
    conversation = Conversation(
        texter_id=texter.id,
        channel=Channel.WEB,
        assigned_account_id=account.id,
        opened_at=now,
    )
    db.add(conversation)
    db.flush()
    return texter, conversation


def test_portal_conversation_decrypts_message_bodies(
    client: TestClient, db: Session, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    """GET returns messages."""
    now = datetime.now(UTC)
    _, conversation = make_conversation_with_texter(db, account, now)
    monkeypatch.setitem(
        app.dependency_overrides,
        require_on_shift,
        lambda: account,
    )
    add_message(db, conversation, MessageSender.TEXTER, "First", now)
    add_message(db, conversation, MessageSender.TEXTER, "Second", now + timedelta(seconds=1))
    db.flush()

    response = client.get(f"/api/portal/conversations/{conversation.id}")

    assert response.status_code == 200
    result = response.json()
    assert [message["body"] for message in result["messages"]] == ["First", "Second"]


def test_portal_conversation_after_works(
    client: TestClient, db: Session, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    """GET returns only messages after the cursor message."""
    now = datetime.now(UTC)
    _, conversation = make_conversation_with_texter(db, account, now)
    monkeypatch.setitem(
        app.dependency_overrides,
        require_on_shift,
        lambda: account,
    )
    first_message = add_message(db, conversation, MessageSender.TEXTER, "First", now)
    add_message(db, conversation, MessageSender.TEXTER, "Second", now + timedelta(seconds=1))
    db.flush()

    response = client.get(
        f"/api/portal/conversations/{conversation.id}", params={"after": str(first_message.id)}
    )

    assert response.status_code == 200
    result = response.json()
    assert [message["body"] for message in result["messages"]] == ["Second"]


def test_portal_send_sets_first_response_once_and_notifies_texter(
    client: TestClient,
    db: Session,
    account: Account,
    monkeypatch: pytest.MonkeyPatch,
    published: list[tuple[str, Event]],
) -> None:
    now = datetime.now(UTC)
    texter, conversation = make_conversation_with_texter(db, account, now)
    monkeypatch.setitem(
        app.dependency_overrides,
        require_on_shift,
        lambda: account,
    )

    assert conversation.first_response_at is None

    # Send first post
    response = client.post(
        f"/api/portal/conversations/{conversation.id}/messages", json={"body": "First reply"}
    )
    assert response.status_code == 201
    assert conversation.first_response_at is not None
    original = conversation.first_response_at

    # Send second post
    response2 = client.post(
        f"/api/portal/conversations/{conversation.id}/messages", json={"body": "Second reply"}
    )

    assert response2.status_code == 201
    assert conversation.first_response_at == original

    texter_events = [event for topic, event in published if topic == texter_topic(texter.id)]

    assert any(
        event["type"] == MESSAGE_CREATED
        and event["data"]["message"]["body"] == "Second reply"
        and event["data"]["conversation_id"] == str(conversation.id)
        for event in texter_events
    )


def test_closed_conversation_sends_409(
    client: TestClient, db: Session, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    """POST returns 409 when message is sent to a closed conversation"""
    now = datetime.now(UTC)
    _, conversation = make_conversation_with_texter(db, account, now)
    monkeypatch.setitem(
        app.dependency_overrides,
        require_on_shift,
        lambda: account,
    )

    conversation.status = ConversationStatus.CLOSED
    db.flush()

    send_response = client.post(
        f"/api/portal/conversations/{conversation.id}/messages",
        json={"body": "Conversation closed"},
    )

    assert send_response.status_code == 409


def test_closes_conversation_and_notifies_texter(
    client: TestClient,
    db: Session,
    account: Account,
    monkeypatch: pytest.MonkeyPatch,
    published: list[tuple[str, Event]],
) -> None:
    now = datetime.now(UTC)
    texter, conversation = make_conversation_with_texter(db, account, now)
    monkeypatch.setitem(
        app.dependency_overrides,
        require_on_shift,
        lambda: account,
    )

    response = client.post(f"/api/portal/conversations/{conversation.id}/end")

    assert response.status_code == 204
    assert conversation.closed_at is not None
    assert conversation.closed_by == ClosedBy.RESPONDER
    assert conversation.status == ConversationStatus.CLOSED

    texter_events = [event for topic, event in published if topic == texter_topic(texter.id)]

    assert any(
        event["type"] == CONVERSATION_CLOSED
        and event["data"]["conversation_id"] == str(conversation.id)
        for event in texter_events
    )

    portal_events = [event for topic, event in published if topic == portal_topic(account.id)]

    assert any(
        event["type"] == CONVERSATION_UPDATED
        and event["data"]["conversation_id"] == str(conversation.id)
        for event in portal_events
    )


def test_identical_404_for_responder_conversation_and_random_UUID(
    client: TestClient, db: Session, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime.now(UTC)
    monkeypatch.setitem(app.dependency_overrides, require_on_shift, lambda: account)

    other_responder = Account(
        email="portal-2-test@unc.edu",
        display_name="Portal test 2 responder",
        password_hash="unused-in-this-test",
        role=AccountRole.RESPONDER,
    )
    db.add(other_responder)
    db.flush()

    _, other_responder_conversation = make_conversation_with_texter(db, other_responder, now)
    other_responder_conversation_response = client.get(
        f"/api/portal/conversations/{other_responder_conversation.id}"
    )

    random_response = client.get(f"/api/portal/conversations/{uuid.uuid4()}")

    assert other_responder_conversation_response.status_code == 404
    assert random_response.status_code == 404
    assert random_response.json() == other_responder_conversation_response.json()


def test_off_shift_gives_403(
    client: TestClient, db: Session, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(
        app.dependency_overrides,
        require_staff,
        lambda: account,
    )
    now = datetime.now(UTC)
    _, conversation = make_conversation_with_texter(db, account, now)

    response = client.get(f"/api/portal/conversations/{conversation.id}")

    assert response.status_code == 403
    assert response.json()["code"] == "not_on_shift"


def test_no_texter_identifier_in_response(
    client: TestClient, db: Session, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Checks that conversations have no texter identifier."""
    now = datetime.now(UTC)
    texter, conversation = make_conversation_with_texter(db, account, now)
    monkeypatch.setitem(
        app.dependency_overrides,
        require_on_shift,
        lambda: account,
    )

    add_message(db, conversation, MessageSender.TEXTER, "Identity test", now)

    add_message(db, conversation, MessageSender.RESPONDER, "Identity test, responder message", now)
    db.flush()
    response = client.get(f"/api/portal/conversations/{conversation.id}")

    assert response.status_code == 200
    assert str(texter.id) not in response.text
    assert texter.identity_hash.hex() not in response.text
    assert "texter_id" not in response.text
    assert "identity_hash" not in response.text
    assert "phone" not in response.text
    assert "ip" not in response.text

    send_response = client.post(
        f"/api/portal/conversations/{conversation.id}/messages",
        json={"body": "Responder privacy test"},
    )

    assert send_response.status_code == 201
    assert str(texter.id) not in send_response.text
    assert texter.identity_hash.hex() not in send_response.text
    assert "texter_id" not in send_response.text
    assert "identity_hash" not in send_response.text
    assert "phone" not in send_response.text
    assert "ip" not in send_response.text
