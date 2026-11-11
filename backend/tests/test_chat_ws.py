import json
import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from httpx2 import Headers
from sqlalchemy import event as sa_event
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from app import events
from app.channels import web
from app.channels.web import hash_token
from app.config import get_settings
from app.events import (
    CONVERSATION_CLOSED,
    MESSAGE_CREATED,
    STATUS_CHANGED,
    Event,
    EventBus,
    texter_topic,
)
from app.models import Account, AccountRole, Channel, Conversation, Message, Shift, Texter
from app.routers import chat_ws
from app.services.messages import message_body
from app.services.pipeline import send_responder_message

PATH = "/ws/chat"
ORIGIN = "http://localhost:3000"
HEADERS = {"origin": ORIGIN}


@pytest.fixture(autouse=True)
def bus(monkeypatch: pytest.MonkeyPatch) -> Iterator[EventBus]:
    bus = EventBus()
    monkeypatch.setattr(events, "event_bus", bus)
    monkeypatch.setattr(web, "event_bus", bus)
    monkeypatch.setattr(chat_ws, "event_bus", bus)
    yield bus
    assert bus._subscribers == {}


@pytest.fixture
def responder(db: Session) -> Account:
    now = datetime.now(UTC)
    account = Account(
        email="private-responder@unc.edu",
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
def token(client: TestClient, responder: Account) -> str:
    response = client.post("/api/chat/sessions")
    assert response.status_code == 201
    return response.json()["token"]


@contextmanager
def authenticated(client: TestClient, token: str) -> Iterator[WebSocketTestSession]:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        socket.send_json({"type": "auth", "token": token})
        # There is no auth acknowledgement. An invalid frame is a barrier proving
        # authentication/subscription finished without creating a conversation or a hit.
        socket.send_json({"type": "ready"})
        assert socket.receive_json()["code"] == "validation_error"
        yield socket


def send_first_message(socket: WebSocketTestSession, body: str = "hello") -> dict:
    socket.send_json({"type": "message", "body": body})
    echo = socket.receive_json()
    assert echo["type"] == MESSAGE_CREATED
    assert echo["data"]["message"]["sender"] == "texter"
    status = socket.receive_json()
    assert status == {
        "type": STATUS_CHANGED,
        "data": {"conversation_id": echo["data"]["conversation_id"], "status": "active"},
    }
    return echo


def test_no_auth_frame_times_out_with_4401(client: TestClient) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4401
    assert chat_ws.AUTH_TIMEOUT_SECONDS == 5


@pytest.mark.parametrize(
    "frame",
    [
        None,
        [],
        {},
        {"type": "message", "body": "unauthenticated"},
        {"type": "auth"},
        {"type": "auth", "token": 123},
        {"type": "auth", "token": "unknown"},
        {"type": "auth", "token": ""},
    ],
)
def test_invalid_auth_closes_with_4401(client: TestClient, frame: object) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        socket.send_json(frame)
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4401


@pytest.mark.parametrize("frame", ["not json", b"binary"])
def test_malformed_auth_closes_with_4401(client: TestClient, frame: str | bytes) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        if isinstance(frame, bytes):
            socket.send_bytes(frame)
        else:
            socket.send_text(frame)
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4401


@pytest.mark.parametrize("invalid", ["revoked", "sms"])
def test_revoked_and_non_web_tokens_are_refused(
    client: TestClient, db: Session, token: str, invalid: str
) -> None:
    texter = db.scalars(select(Texter)).one()
    if invalid == "revoked":
        texter.revoked_at = datetime.now(UTC)
    else:
        texter.channel = Channel.SMS
    db.commit()
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        socket.send_json({"type": "auth", "token": token})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4401


@pytest.mark.parametrize(
    "origins",
    [[], ["null"], ["https://evil.example"], [ORIGIN + ".evil.example"], [ORIGIN, ORIGIN]],
)
def test_wrong_missing_or_duplicate_origins_are_refused(
    client: TestClient, origins: list[str]
) -> None:
    with (
        pytest.raises(WebSocketDisconnect) as error,
        client.websocket_connect(PATH, headers=Headers([("origin", origin) for origin in origins])),
    ):
        pytest.fail("Untrusted origin was accepted")
    assert error.value.code == 1008


def test_configured_origin_is_used(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured = "https://chat.example.com"
    monkeypatch.setattr(get_settings(), "app_origin", configured)
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(PATH, headers=HEADERS):
        pytest.fail("Old origin was accepted")
    with client.websocket_connect(PATH, headers={"origin": configured}) as socket:
        socket.send_json({"type": "auth", "token": token})
        send_first_message(socket)


def test_socket_message_is_committed_encrypted_and_echoed(
    client: TestClient, db: Session, token: str
) -> None:
    committed: list[bool] = []

    def after_commit(session: Session) -> None:
        committed.append(True)

    with authenticated(client, token) as socket:
        sa_event.listen(db, "after_commit", after_commit)
        try:
            echo = send_first_message(socket, "  hello 🙂  ")
        finally:
            sa_event.remove(db, "after_commit", after_commit)
        assert committed
        message = db.get(Message, uuid.UUID(echo["data"]["message"]["id"]))
        assert message is not None
        assert message_body(message) == "hello 🙂"
        assert "hello 🙂".encode() not in message.body_ciphertext
        assert echo["data"]["message"]["body"] == "hello 🙂"
        socket.send_json({"type": "message", "body": "still here"})
        assert socket.receive_json()["data"]["message"]["body"] == "still here"
    assert db.scalar(select(func.count()).select_from(Conversation)) == 1


def test_responder_message_reaches_texter_without_private_fields(
    client: TestClient, db: Session, token: str, responder: Account
) -> None:
    with authenticated(client, token) as socket:
        echo = send_first_message(socket)
        conversation = db.scalars(select(Conversation)).one()
        message = send_responder_message(db, conversation, responder, "I'm here", datetime.now(UTC))
        db.commit()
        event = socket.receive_json()
        assert event["type"] == MESSAGE_CREATED
        assert event["data"]["message"]["id"] == str(message.id)
        assert event["data"]["message"]["sender"] == "responder"
        assert event["data"]["message"]["body"] == "I'm here"
        for frame in (echo, event):
            assert set(frame["data"]) == {"conversation_id", "message"}
            assert set(frame["data"]["message"]) == {"id", "sender", "body", "created_at"}
            serialized = json.dumps(frame)
            texter = db.scalars(select(Texter)).one()
            for private in (
                responder.display_name,
                responder.email,
                str(responder.id),
                str(texter.id),
                texter.identity_hash.hex(),
                token,
                "texter_id",
                "identity_hash",
                "phone",
                "ip_address",
            ):
                assert private not in serialized


@pytest.mark.parametrize("has_conversation", [False, True])
def test_ending_over_rest_sends_close_and_disconnects_all_tabs(
    client: TestClient, db: Session, token: str, has_conversation: bool
) -> None:
    with authenticated(client, token) as first, authenticated(client, token) as second:
        if has_conversation:
            echo = send_first_message(first)
            assert second.receive_json() == echo
            assert second.receive_json()["type"] == STATUS_CHANGED
        response = client.post(
            "/api/chat/conversation/end", headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 204
        expected = {"closed_by": "texter"}
        if has_conversation:
            expected["conversation_id"] = echo["data"]["conversation_id"]
        for socket in (first, second):
            assert socket.receive_json() == {"type": CONVERSATION_CLOSED, "data": expected}
            with pytest.raises(WebSocketDisconnect) as error:
                socket.receive_json()
            assert error.value.code == 4401
    assert db.scalars(select(Texter)).one().revoked_at is not None


def test_rate_limit_is_shared_with_rest_and_errors_keep_socket_open(
    client: TestClient, db: Session, token: str, bus: EventBus
) -> None:
    with authenticated(client, token) as socket:
        send_first_message(socket)
        headers = {"Authorization": f"Bearer {token}"}
        for _ in range(19):
            response = client.post("/api/chat/messages", headers=headers, json={"body": "REST"})
            assert response.status_code == 201
            assert socket.receive_json()["data"]["message"]["id"] == response.json()["id"]
        socket.send_json({"type": "message", "body": "blocked"})
        error = socket.receive_json()
        assert error == {
            "type": "error",
            "code": "rate_limited",
            "detail": "Too many requests. Try again later.",
        }
        response = client.post("/api/chat/messages", headers=headers, json={"body": "blocked"})
        assert response.status_code == 429
        assert 0 < int(response.headers["Retry-After"]) <= 60
        assert db.scalar(select(func.count()).select_from(Message)) == 20
        event: Event = {"type": STATUS_CHANGED, "data": {"status": "active"}}
        texter = db.scalars(select(Texter)).one()
        bus.publish(texter_topic(texter.id), event)
        assert socket.receive_json() == event


@pytest.mark.parametrize(
    "payload", [{}, {"body": ""}, {"body": " \n\t"}, {"body": "x" * 2001}, {"body": 1}]
)
def test_invalid_messages_return_errors_and_allow_a_later_valid_message(
    client: TestClient, db: Session, token: str, payload: dict
) -> None:
    with authenticated(client, token) as socket:
        socket.send_json({"type": "message", **payload})
        error = socket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "validation_error"
        assert error["detail"].startswith("body:")
        assert db.scalar(select(func.count()).select_from(Message)) == 0
        send_first_message(socket, "  " + "x" * 2000 + "\n")


@pytest.mark.parametrize("frame", ["not json", b"binary", "null", "[]", '{"type":"auth"}'])
def test_bad_frames_return_an_error_without_disconnecting(
    client: TestClient, token: str, frame: str | bytes
) -> None:
    with authenticated(client, token) as socket:
        if isinstance(frame, bytes):
            socket.send_bytes(frame)
        else:
            socket.send_text(frame)
        assert socket.receive_json()["code"] == "validation_error"
        send_first_message(socket)


def test_each_send_rechecks_revocation(client: TestClient, db: Session, token: str) -> None:
    with authenticated(client, token) as socket:
        db.execute(
            update(Texter)
            .where(Texter.identity_hash == hash_token(token))
            .values(revoked_at=datetime.now(UTC)),
            execution_options={"synchronize_session": False},
        )
        db.commit()
        socket.send_json({"type": "message", "body": "must not save"})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4401
    assert db.scalar(select(func.count()).select_from(Message)) == 0


def test_events_are_filtered_by_topic_and_type(
    client: TestClient, db: Session, token: str, bus: EventBus
) -> None:
    with authenticated(client, token) as socket:
        texter = db.scalars(select(Texter)).one()
        bus.publish(texter_topic(uuid.uuid4()), {"type": MESSAGE_CREATED, "data": {"other": True}})
        bus.publish(texter_topic(texter.id), {"type": "internal", "data": {"private": True}})
        event: Event = {"type": STATUS_CHANGED, "data": {"status": "active"}}
        bus.publish(texter_topic(texter.id), event)
        assert socket.receive_json() == event
        closed: Event = {"type": CONVERSATION_CLOSED, "data": {"closed_by": "responder"}}
        bus.publish(texter_topic(texter.id), closed)
        assert socket.receive_json() == closed
        # A responder closure leaves the token usable for a new conversation.
        send_first_message(socket)


def test_tokens_and_messages_never_appear_in_application_logs(
    client: TestClient, token: str, caplog: pytest.LogCaptureFixture
) -> None:
    body = "Distinct private websocket message"
    with caplog.at_level(logging.INFO, logger="app"), authenticated(client, token) as socket:
        send_first_message(socket, body)
        socket.send_json({"type": "message", "body": "x" * 2001})
        assert socket.receive_json()["type"] == "error"
    assert token not in caplog.text
    assert body not in caplog.text
