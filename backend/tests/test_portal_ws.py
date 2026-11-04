import threading
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from app import events
from app.config import get_settings
from app.events import (
    CONVERSATION_CREATED,
    CONVERSATION_UPDATED,
    MESSAGE_CREATED,
    SESSION_REVOKED,
    SHIFT_ENDED,
    Event,
    EventBus,
    portal_topic,
)
from app.models import Account, AuthSession, Shift
from app.routers.portal import ws as portal_ws
from app.services.sessions import (
    SESSION_COOKIE_NAME,
    issue_session,
    revoke_all_sessions,
    revoke_session,
)
from app.services.shifts import start_shift
from tests.test_sessions import make_account

PATH = "/ws/portal"
ORIGIN = "http://localhost:3000"
HEADERS = {"origin": ORIGIN}


class Clock:
    value = datetime(2026, 11, 3, 18, 0, tzinfo=UTC)

    def now(self, tz) -> datetime:
        return self.value


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(portal_ws, "datetime", clock)
    return clock


@pytest.fixture(autouse=True)
def bus(monkeypatch: pytest.MonkeyPatch):
    bus = EventBus()
    monkeypatch.setattr(events, "event_bus", bus)
    monkeypatch.setattr(portal_ws, "event_bus", bus)
    yield bus
    # Every exit path must remove its subscription, including errors and client disconnects.
    assert bus._subscribers == {}


@pytest.fixture
def account(db: Session) -> Account:
    return make_account(db)


@pytest.fixture
def auth_session(db: Session, client: TestClient, account: Account, clock: Clock) -> AuthSession:
    token = issue_session(db, account, clock.value)
    db.commit()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return db.scalars(select(AuthSession)).one()


@pytest.fixture
def heartbeat_done(monkeypatch: pytest.MonkeyPatch) -> threading.Event:
    done = threading.Event()
    check = portal_ws._check_session

    def observed(db: Session, token: str, *, heartbeat: bool = False):
        result = check(db, token, heartbeat=heartbeat)
        if heartbeat:
            done.set()
        return result

    monkeypatch.setattr(portal_ws, "_check_session", observed)
    return done


@pytest.mark.parametrize("token", [None, "invalid-token"])
def test_missing_or_bad_cookie_closes_with_4001(client: TestClient, token: str | None) -> None:
    if token is not None:
        client.cookies.set(SESSION_COOKIE_NAME, token)
    with (
        pytest.raises(WebSocketDisconnect) as error,
        client.websocket_connect(PATH, headers=HEADERS) as socket,
    ):
        socket.receive_json()
    assert error.value.code == 4001


@pytest.mark.parametrize(
    "origin",
    [None, "null", "https://evil.example", ORIGIN + ".evil.example", "https://localhost:3000"],
)
def test_wrong_or_missing_origin_is_refused(
    client: TestClient, auth_session: AuthSession, origin: str | None
) -> None:
    headers = {"origin": origin} if origin is not None else {}
    with (
        pytest.raises(WebSocketDisconnect) as error,
        client.websocket_connect(PATH, headers=headers),
    ):
        pytest.fail("Untrusted origin was accepted")
    assert error.value.code == 1008


def test_configured_origin_is_used(
    client: TestClient, auth_session: AuthSession, bus: EventBus, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured = "https://portal.example.com"
    monkeypatch.setattr(get_settings(), "app_origin", configured)
    with pytest.raises(WebSocketDisconnect), client.websocket_connect(PATH, headers=HEADERS):
        pytest.fail("Old origin was accepted")
    with client.websocket_connect(PATH, headers={"origin": configured}) as socket:
        event: Event = {"type": SHIFT_ENDED, "data": {}}
        bus.publish(portal_topic(auth_session.account_id), event)
        assert socket.receive_json() == event


@pytest.mark.parametrize("invalid", ["revoked", "expired", "idle", "inactive"])
def test_invalid_session_is_refused(
    db: Session,
    client: TestClient,
    auth_session: AuthSession,
    account: Account,
    clock: Clock,
    invalid: str,
) -> None:
    if invalid == "revoked":
        auth_session.revoked_at = clock.value
    elif invalid == "expired":
        auth_session.expires_at = clock.value
    elif invalid == "idle":
        auth_session.last_seen_at = clock.value - timedelta(minutes=30)
    else:
        account.is_active = False
    db.commit()

    with (
        pytest.raises(WebSocketDisconnect) as error,
        client.websocket_connect(PATH, headers=HEADERS) as socket,
    ):
        socket.receive_json()
    assert error.value.code == 4001


def test_heartbeat_updates_shift_without_session_activity(
    db: Session,
    client: TestClient,
    auth_session: AuthSession,
    account: Account,
    clock: Clock,
    heartbeat_done: threading.Event,
) -> None:
    original_activity = auth_session.last_seen_at
    shift = start_shift(db, account, clock.value)
    db.commit()
    # Reconnecting and heartbeats must both preserve idle expiry, even past the write throttle.
    clock.value += timedelta(minutes=2)
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        db.refresh(auth_session)
        assert auth_session.last_seen_at == original_activity
        for minutes in [3, 29]:
            clock.value = original_activity + timedelta(minutes=minutes)
            heartbeat_done.clear()
            socket.send_json({"type": "heartbeat"})
            assert heartbeat_done.wait(timeout=2)
            db.refresh(shift)
            db.refresh(auth_session)
            assert shift.last_heartbeat_at == clock.value
            assert auth_session.last_seen_at == original_activity
        clock.value = original_activity + timedelta(minutes=30)
        socket.send_json({"type": "heartbeat"})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4001
    db.refresh(auth_session)
    assert auth_session.revoked_at == clock.value


def test_heartbeat_works_off_shift(
    db: Session,
    client: TestClient,
    auth_session: AuthSession,
    clock: Clock,
    heartbeat_done: threading.Event,
    bus: EventBus,
) -> None:
    clock.value += timedelta(minutes=2)
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        socket.send_json({"type": "heartbeat"})
        assert heartbeat_done.wait(timeout=2)
        assert db.scalars(select(Shift)).all() == []
        event: Event = {"type": SHIFT_ENDED, "data": {}}
        bus.publish(portal_topic(auth_session.account_id), event)
        assert socket.receive_json() == event


@pytest.mark.parametrize(
    "event_type", [CONVERSATION_CREATED, CONVERSATION_UPDATED, MESSAGE_CREATED, SHIFT_ENDED]
)
def test_only_account_topic_events_reach_the_client(
    client: TestClient, auth_session: AuthSession, bus: EventBus, event_type: str
) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        bus.publish(portal_topic(uuid.uuid4()), {"type": event_type, "data": {"id": "other"}})
        event: Event = {"type": event_type, "data": {"id": "own"}}
        bus.publish(portal_topic(auth_session.account_id), event)
        assert socket.receive_json() == event


def test_each_tab_gets_events(client: TestClient, auth_session: AuthSession, bus: EventBus) -> None:
    with (
        client.websocket_connect(PATH, headers=HEADERS) as first,
        client.websocket_connect(PATH, headers=HEADERS) as second,
    ):
        event: Event = {"type": MESSAGE_CREATED, "data": {"id": "message"}}
        bus.publish(portal_topic(auth_session.account_id), event)
        assert first.receive_json() == second.receive_json() == event


@pytest.mark.parametrize("bulk", [False, True])
def test_committed_revocation_is_forwarded_and_closes_the_socket(
    db: Session,
    client: TestClient,
    auth_session: AuthSession,
    clock: Clock,
    bulk: bool,
) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        if bulk:
            revoke_all_sessions(db, auth_session.account_id, clock.value)
        else:
            revoke_session(db, auth_session, clock.value)
        db.commit()
        assert socket.receive_json() == {"type": SESSION_REVOKED, "data": {}}
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4001


@pytest.mark.parametrize("bulk", [False, True])
def test_other_session_revocation_keeps_the_socket_open(
    db: Session,
    client: TestClient,
    auth_session: AuthSession,
    account: Account,
    clock: Clock,
    bus: EventBus,
    bulk: bool,
) -> None:
    issue_session(db, account, clock.value)
    db.commit()
    other = db.scalars(select(AuthSession).where(AuthSession.id != auth_session.id)).one()
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        if bulk:
            revoke_all_sessions(db, account.id, clock.value, except_session_id=auth_session.id)
        else:
            revoke_session(db, other, clock.value)
        db.commit()
        # The revocation is skipped, so the next event is the first one the client sees.
        event: Event = {"type": SHIFT_ENDED, "data": {}}
        bus.publish(portal_topic(account.id), event)
        assert socket.receive_json() == event
    db.refresh(auth_session)
    assert auth_session.revoked_at is None


@pytest.mark.parametrize("invalid", ["revoked", "expired", "inactive"])
def test_heartbeat_rechecks_session_against_database(
    db: Session,
    client: TestClient,
    auth_session: AuthSession,
    account: Account,
    clock: Clock,
    invalid: str,
) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        # Write without an event or ORM cache synchronization to model another request/process.
        if invalid == "inactive":
            statement = update(Account).where(Account.id == account.id).values(is_active=False)
        else:
            values = {"revoked_at" if invalid == "revoked" else "expires_at": clock.value}
            statement = (
                update(AuthSession).where(AuthSession.id == auth_session.id).values(**values)
            )
        db.execute(statement, execution_options={"synchronize_session": False})
        db.commit()
        socket.send_json({"type": "heartbeat"})
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 4001


@pytest.mark.parametrize("frame", ["not json", b"binary"])
def test_invalid_frame_closes_and_unsubscribes(
    client: TestClient, auth_session: AuthSession, frame: str | bytes
) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        if isinstance(frame, bytes):
            socket.send_bytes(frame)
        else:
            socket.send_text(frame)
        with pytest.raises(WebSocketDisconnect) as error:
            socket.receive_json()
        assert error.value.code == 1003


@pytest.mark.parametrize("frame", [None, [], {"type": "unknown"}])
def test_other_json_is_ignored(
    client: TestClient, auth_session: AuthSession, bus: EventBus, frame
) -> None:
    with client.websocket_connect(PATH, headers=HEADERS) as socket:
        socket.send_json(frame)
        event: Event = {"type": SHIFT_ENDED, "data": {}}
        bus.publish(portal_topic(auth_session.account_id), event)
        assert socket.receive_json() == event
