from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import events
from app.config import get_settings
from app.database import get_db
from app.dependencies import auth
from app.jobs import close_idle_sessions, close_inactive_conversations, close_lost_shifts
from app.models import (
    Account,
    AuthSession,
    Channel,
    ClosedBy,
    Conversation,
    ConversationStatus,
    ShiftEndReason,
    Texter,
)
from app.services.sessions import SESSION_COOKIE_NAME, issue_session, resolve_session
from app.services.shifts import start_shift
from app.services.site_settings import get_setting, set_setting
from tests.test_sessions import make_account

NOW = datetime(2026, 11, 7, 18, tzinfo=UTC)
STEP = timedelta(microseconds=1)


def make_conversation(
    db: Session,
    account: Account | None = None,
    *,
    last_message_at: datetime | None = NOW - timedelta(minutes=31),
    status: ConversationStatus = ConversationStatus.ACTIVE,
    texter: Texter | None = None,
) -> Conversation:
    conversation = Conversation(
        channel=Channel.WEB,
        opened_at=NOW - timedelta(hours=1),
        assigned_account_id=account.id if account else None,
        assigned_at=NOW - timedelta(minutes=45) if account else None,
        texter_id=texter.id if texter else None,
        status=status,
        last_message_at=last_message_at,
    )
    db.add(conversation)
    db.flush()
    return conversation


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, events.Event]]:
    result: list[tuple[str, events.Event]] = []
    monkeypatch.setattr(
        events.event_bus, "publish", lambda topic, event: result.append((topic, event))
    )
    return result


@pytest.mark.parametrize("offset,expected", [(-STEP, 1), (timedelta(0), 0), (STEP, 0)])
def test_lost_heartbeat_boundary(db: Session, offset: timedelta, expected: int) -> None:
    account = make_account(db)
    shift = start_shift(db, account, NOW - timedelta(minutes=5) + offset)

    assert close_lost_shifts(db, NOW) == expected
    db.refresh(shift)
    assert shift.ended_at == (NOW if expected else None)
    assert shift.ended_reason == (ShiftEndReason.HEARTBEAT_LOST if expected else None)
    assert close_lost_shifts(db, NOW) == 0


def test_lost_shift_requeues_active_conversations_only(
    db: Session, published: list[tuple[str, events.Event]]
) -> None:
    account = make_account(db)
    shift = start_shift(db, account, NOW - timedelta(minutes=6))
    active = make_conversation(db, account)
    closed = make_conversation(db, account, status=ConversationStatus.CLOSED)
    # Previously closed shifts stay untouched even when their heartbeat is stale.
    previous = start_shift(db, make_account(db, "previous@unc.edu"), NOW - timedelta(hours=2))
    previous.ended_at = NOW - timedelta(hours=1)
    previous.ended_reason = ShiftEndReason.MANUAL
    db.commit()

    assert close_lost_shifts(db, NOW) == 1
    assert published == []
    assert close_lost_shifts(db, NOW) == 0
    db.commit()
    db.refresh(active)
    db.refresh(closed)
    db.refresh(previous)
    assert active.status == ConversationStatus.QUEUED
    assert active.assigned_account_id is None
    assert active.assigned_at is None
    assert closed.status == ConversationStatus.CLOSED
    assert closed.assigned_account_id == account.id
    assert previous.ended_reason == ShiftEndReason.MANUAL
    assert published == [
        (
            events.portal_topic(account.id),
            {
                "type": events.SHIFT_ENDED,
                "data": {"shift_id": str(shift.id), "reason": "heartbeat_lost"},
            },
        )
    ]


def test_lost_shift_reassigns_to_online_responder(db: Session) -> None:
    lost = make_account(db)
    start_shift(db, lost, NOW - timedelta(minutes=6))
    available = make_account(db, "available@unc.edu")
    start_shift(db, available, NOW)
    conversation = make_conversation(db, lost)

    assert close_lost_shifts(db, NOW) == 1
    db.refresh(conversation)
    assert conversation.status == ConversationStatus.ACTIVE
    assert conversation.assigned_account_id == available.id
    assert conversation.assigned_at == NOW


@pytest.mark.parametrize("offset,expected", [(-STEP, 1), (timedelta(0), 1), (STEP, 0)])
def test_idle_session_boundary_uses_configured_timeout(
    db: Session, monkeypatch: pytest.MonkeyPatch, offset: timedelta, expected: int
) -> None:
    monkeypatch.setattr(get_settings(), "session_idle_minutes", 17)
    account = make_account(db)
    issue_session(db, account, NOW - timedelta(minutes=17) + offset)
    session = db.scalars(select(AuthSession)).one()

    assert close_idle_sessions(db, NOW) == expected
    db.refresh(session)
    assert session.revoked_at == (NOW if expected else None)
    assert close_idle_sessions(db, NOW) == 0


@pytest.mark.parametrize("via_request", [False, True])
def test_idle_session_ends_shift_and_requeues(
    db: Session,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    published: list[tuple[str, events.Event]],
    via_request: bool,
) -> None:
    from app.main import app

    account = make_account(db)
    token = issue_session(db, account, NOW - timedelta(minutes=get_settings().session_idle_minutes))
    session = db.scalars(select(AuthSession)).one()
    shift = start_shift(db, account, NOW)  # A healthy heartbeat must not defeat idle expiry.
    conversation = make_conversation(db, account)
    db.commit()
    if via_request:
        monkeypatch.setattr(auth, "datetime", SimpleNamespace(now=lambda tz: NOW))

        def request_db():
            try:
                yield db
            finally:
                db.rollback()

        app.dependency_overrides[get_db] = request_db
        client.cookies.set(SESSION_COOKIE_NAME, token)
        assert client.get("/api/auth/me").status_code == 401
    else:
        assert close_idle_sessions(db, NOW) == 1
        assert published == []
        db.commit()

    db.expire_all()
    assert session.revoked_at == NOW
    assert shift.ended_at == NOW
    assert shift.ended_reason == ShiftEndReason.IDLE
    assert conversation.status == ConversationStatus.QUEUED
    assert conversation.assigned_account_id is None
    assert [event["type"] for _, event in published] == [events.SESSION_REVOKED, events.SHIFT_ENDED]
    assert close_idle_sessions(db, NOW) == 0
    assert resolve_session(db, token, NOW) is None
    db.commit()
    assert len(published) == 2


def test_multiple_idle_sessions_end_shift_once_and_skip_revoked(db: Session) -> None:
    account = make_account(db)
    for _ in range(3):
        issue_session(db, account, NOW - timedelta(hours=1))
    sessions = db.scalars(select(AuthSession)).all()
    sessions[0].revoked_at = NOW - timedelta(minutes=1)
    shift = start_shift(db, account, NOW)
    db.flush()

    assert close_idle_sessions(db, NOW) == 2
    db.refresh(shift)
    assert shift.ended_reason == ShiftEndReason.IDLE
    assert sessions[0].revoked_at == NOW - timedelta(minutes=1)
    assert close_idle_sessions(db, NOW) == 0


@pytest.mark.parametrize("status", [ConversationStatus.QUEUED, ConversationStatus.ACTIVE])
@pytest.mark.parametrize("offset,expected", [(-STEP, 1), (timedelta(0), 0), (STEP, 0)])
def test_inactive_conversation_boundary(
    db: Session, status: ConversationStatus, offset: timedelta, expected: int
) -> None:
    conversation = make_conversation(
        db, status=status, last_message_at=NOW - timedelta(minutes=30) + offset
    )

    assert close_inactive_conversations(db, NOW) == expected
    db.refresh(conversation)
    assert conversation.status == (ConversationStatus.CLOSED if expected else status)
    assert conversation.closed_at == (NOW if expected else None)
    assert conversation.closed_by == (ClosedBy.INACTIVITY if expected else None)
    assert close_inactive_conversations(db, NOW) == 0


def test_inactive_closure_notifies_both_participants_after_commit(
    db: Session, published: list[tuple[str, events.Event]]
) -> None:
    account = make_account(db)
    texter = Texter(channel=Channel.WEB, identity_hash=b"test-identity", last_seen_at=NOW)
    db.add(texter)
    db.flush()
    active = make_conversation(db, account, texter=texter)
    queued = make_conversation(db, status=ConversationStatus.QUEUED, texter=texter)
    recent = make_conversation(db, last_message_at=NOW)
    closed = make_conversation(db, status=ConversationStatus.CLOSED)
    no_message = make_conversation(db, last_message_at=None)
    db.commit()

    assert close_inactive_conversations(db, NOW) == 2
    assert published == []
    assert close_inactive_conversations(db, NOW) == 0
    db.commit()
    assert len(published) == 3
    for conversation in (active, queued):
        data = {"conversation_id": str(conversation.id), "closed_by": "inactivity"}
        assert (
            events.texter_topic(texter.id),
            {"type": events.CONVERSATION_CLOSED, "data": data},
        ) in published
    assert (
        events.portal_topic(account.id),
        {
            "type": events.CONVERSATION_UPDATED,
            "data": {
                "conversation_id": str(active.id),
                "closed_by": "inactivity",
                "status": "closed",
            },
        },
    ) in published
    assert active.assigned_account_id == account.id  # Retained for the post-conversation report.
    assert recent.status == ConversationStatus.ACTIVE
    assert no_message.status == ConversationStatus.ACTIVE
    assert closed.closed_by is None


def test_conversation_timeout_uses_site_setting(db: Session) -> None:
    assert get_setting(db, "conversation_inactive_minutes") == 30
    conversation = make_conversation(db)
    set_setting(db, "conversation_inactive_minutes", 45, None)
    assert close_inactive_conversations(db, NOW) == 0
    set_setting(db, "conversation_inactive_minutes", 20, None)
    assert close_inactive_conversations(db, NOW) == 1
    assert conversation.closed_by == ClosedBy.INACTIVITY


@pytest.mark.parametrize(
    "job", [close_lost_shifts, close_idle_sessions, close_inactive_conversations]
)
def test_jobs_leave_commit_to_caller_and_drop_events_on_rollback(
    db: Session, published: list[tuple[str, events.Event]], job
) -> None:
    account = make_account(db)
    issue_session(db, account, NOW - timedelta(hours=1))
    session = db.scalars(select(AuthSession)).one()
    shift = start_shift(db, account, NOW - timedelta(minutes=6))
    conversation = make_conversation(db, account)
    db.commit()

    assert job(db, NOW) == 1
    assert published == []
    db.rollback()
    db.commit()
    assert published == []
    db.refresh(session)
    db.refresh(shift)
    db.refresh(conversation)
    assert session.revoked_at is None
    assert shift.ended_at is None
    assert conversation.status == ConversationStatus.ACTIVE
    assert conversation.assigned_account_id == account.id
