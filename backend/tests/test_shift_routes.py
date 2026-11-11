import hashlib
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import events
from app.database import get_db
from app.dependencies.auth import require_on_shift
from app.errors import AppError
from app.events import (
    CONVERSATION_CREATED,
    MESSAGE_CREATED,
    SHIFT_ENDED,
    STATUS_CHANGED,
    Event,
    portal_topic,
    texter_topic,
)
from app.main import app
from app.models import Account, AccountRole, Channel, Conversation, ConversationStatus
from app.models.shift import Shift, ShiftEndReason
from app.security.passwords import hash_password
from app.services.pipeline import handle_inbound
from app.services.shifts import get_open_shift, start_shift

PASSWORD = "A distinct! password 2026"
EMAIL = "staff@unc.edu"


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
def account(db: Session, password_hash: str) -> Account:
    account = Account(
        email=EMAIL,
        display_name="Test staff",
        password_hash=password_hash,
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.commit()
    return account


@pytest.fixture
def staff_client(db: Session, account: Account) -> Iterator[TestClient]:
    def override_db() -> Iterator[Session]:
        try:
            yield db
        finally:
            # Model get_db closing a real session, so missing commits cannot pass tests.
            db.rollback()

    app.dependency_overrides[get_db] = override_db
    try:
        # HTTPS so the session cookie comes back whether or not it is marked Secure.
        with TestClient(app, base_url="https://testserver") as client:
            response = client.post("/api/auth/sign-in", json={"email": EMAIL, "password": PASSWORD})
            assert response.status_code == 200
            yield client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Event]]:
    sent: list[tuple[str, Event]] = []
    monkeypatch.setattr(events.event_bus, "publish", lambda topic, e: sent.append((topic, e)))
    return sent


def make_responder(db: Session) -> Account:
    account = Account(
        email=f"{uuid.uuid4()}@unc.edu",
        display_name="Other responder",
        password_hash="unused",
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.flush()
    start_shift(db, account, datetime.now(UTC))
    db.commit()
    return account


def make_conversation(
    db: Session,
    *,
    opened_at: datetime,
    account: Account | None = None,
    status: ConversationStatus = ConversationStatus.QUEUED,
) -> Conversation:
    conversation = Conversation(
        channel=Channel.WEB,
        opened_at=opened_at,
        status=status,
        assigned_account_id=account.id if account else None,
        assigned_at=opened_at if account else None,
        closed_at=opened_at if status == ConversationStatus.CLOSED else None,
    )
    db.add(conversation)
    db.commit()
    return conversation


def created_events(published: list[tuple[str, Event]], account: Account) -> list[str]:
    return [
        e["data"]["conversation_id"]
        for topic, e in published
        if topic == portal_topic(account.id) and e["type"] == CONVERSATION_CREATED
    ]


def test_start_returns_shift_and_assigns_queued_in_order(
    db: Session, staff_client: TestClient, account: Account, published: list[tuple[str, Event]]
) -> None:
    now = datetime.now(UTC)
    newer = make_conversation(db, opened_at=now - timedelta(minutes=1))
    older = make_conversation(db, opened_at=now - timedelta(minutes=5))

    response = staff_client.post("/api/portal/shift/start")

    assert response.status_code == 200
    shift = get_open_shift(db, account.id)
    assert shift is not None
    assert response.json()["id"] == str(shift.id)
    db.expire_all()
    for conversation in (older, newer):
        assert conversation.status == ConversationStatus.ACTIVE
        assert conversation.assigned_account_id == account.id
    assert created_events(published, account) == [str(older.id), str(newer.id)]


def test_starting_twice_returns_the_same_shift(
    db: Session, staff_client: TestClient, account: Account
) -> None:
    first = staff_client.post("/api/portal/shift/start")
    second = staff_client.post("/api/portal/shift/start")

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(db.scalars(select(Shift).where(Shift.account_id == account.id)).all()) == 1


def test_end_requeues_active_but_keeps_closed_conversations(
    db: Session, staff_client: TestClient, account: Account, published: list[tuple[str, Event]]
) -> None:
    assert staff_client.post("/api/portal/shift/start").status_code == 200
    now = datetime.now(UTC)
    active = make_conversation(db, opened_at=now, account=account, status=ConversationStatus.ACTIVE)
    closed = make_conversation(db, opened_at=now, account=account, status=ConversationStatus.CLOSED)
    shift = get_open_shift(db, account.id)
    assert shift is not None

    response = staff_client.post("/api/portal/shift/end")

    assert response.status_code == 204
    db.expire_all()
    assert shift.ended_reason == ShiftEndReason.MANUAL
    assert active.status == ConversationStatus.QUEUED
    assert active.assigned_account_id is None
    assert closed.status == ConversationStatus.CLOSED
    assert closed.assigned_account_id == account.id
    assert (portal_topic(account.id), SHIFT_ENDED) in [(t, e["type"]) for t, e in published]


def test_end_hands_active_conversations_to_another_responder(
    db: Session, staff_client: TestClient, account: Account, published: list[tuple[str, Event]]
) -> None:
    assert staff_client.post("/api/portal/shift/start").status_code == 200
    other = make_responder(db)
    conversation = make_conversation(
        db, opened_at=datetime.now(UTC), account=account, status=ConversationStatus.ACTIVE
    )

    assert staff_client.post("/api/portal/shift/end").status_code == 204

    db.expire_all()
    assert conversation.status == ConversationStatus.ACTIVE
    assert conversation.assigned_account_id == other.id
    assert created_events(published, other) == [str(conversation.id)]


def test_end_without_a_shift_is_fine(staff_client: TestClient) -> None:
    assert staff_client.post("/api/portal/shift/end").status_code == 204


def test_require_on_shift(db: Session, account: Account) -> None:
    with pytest.raises(AppError) as error:
        require_on_shift(account, db)
    assert error.value.status_code == 403
    assert error.value.code == "not_on_shift"

    start_shift(db, account, datetime.now(UTC))
    assert require_on_shift(account, db) is account


def test_new_inbound_goes_to_the_on_shift_responder(
    db: Session, staff_client: TestClient, account: Account, published: list[tuple[str, Event]]
) -> None:
    assert staff_client.post("/api/portal/shift/start").status_code == 200

    identity = hashlib.sha256(b"texter").digest()
    conversation = handle_inbound(db, Channel.WEB, identity, "hi", datetime.now(UTC)).conversation
    db.commit()

    assert conversation.texter_id is not None
    assert conversation.status == ConversationStatus.ACTIVE
    assert conversation.assigned_account_id == account.id
    assert created_events(published, account) == [str(conversation.id)]
    texter_events = [e for t, e in published if t == texter_topic(conversation.texter_id)]
    assert [e["type"] for e in texter_events] == [MESSAGE_CREATED, STATUS_CHANGED]
    assert texter_events[1]["data"] == {
        "conversation_id": str(conversation.id),
        "status": ConversationStatus.ACTIVE.value,
    }


def test_sign_out_requeues(
    db: Session, staff_client: TestClient, account: Account, published: list[tuple[str, Event]]
) -> None:
    assert staff_client.post("/api/portal/shift/start").status_code == 200
    conversation = make_conversation(
        db, opened_at=datetime.now(UTC), account=account, status=ConversationStatus.ACTIVE
    )

    assert staff_client.post("/api/auth/sign-out").status_code == 204

    db.expire_all()
    assert get_open_shift(db, account.id) is None
    assert conversation.status == ConversationStatus.QUEUED
    assert conversation.assigned_account_id is None
    assert (portal_topic(account.id), SHIFT_ENDED) in [(t, e["type"]) for t, e in published]
