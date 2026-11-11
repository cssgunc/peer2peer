import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy import event as sa_event
from sqlalchemy.orm import Session

from app import events
from app.database import get_db
from app.events import CONVERSATION_UPDATED, Event, portal_topic
from app.main import app
from app.models import (
    Account,
    AccountRole,
    Channel,
    Conversation,
    ConversationReport,
    ConversationStatus,
    MessageSender,
    ReportOption,
    ReportOptionKind,
    Texter,
)
from app.models.shift import ShiftEndReason
from app.security.passwords import hash_password
from app.services.messages import add_message
from app.services.shifts import end_shift_and_requeue, start_shift

PASSWORD = "A distinct! password 2026"
EMAIL = "inbox@unc.edu"
IDENTITY_HASH = b"\xab" * 32

INBOX_FIELDS = {
    "conversation_id",
    "label",
    "channel",
    "status",
    "opened_at",
    "last_message_at",
    "unread_count",
    "needs_report",
}


@pytest.fixture
def account(db: Session) -> Account:
    account = Account(
        email=EMAIL,
        display_name="Inbox staff",
        password_hash=hash_password(PASSWORD),
        role=AccountRole.RESPONDER,
        must_change_password=False,
    )
    db.add(account)
    db.flush()
    start_shift(db, account, datetime.now(UTC))
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


@pytest.fixture
def texter(db: Session) -> Texter:
    texter = Texter(
        channel=Channel.WEB, identity_hash=IDENTITY_HASH, last_seen_at=datetime.now(UTC)
    )
    db.add(texter)
    db.commit()
    return texter


def make_responder(db: Session) -> Account:
    other = Account(
        email=f"{uuid.uuid4()}@unc.edu",
        display_name="Other responder",
        password_hash="unused",
        role=AccountRole.RESPONDER,
    )
    db.add(other)
    db.commit()
    return other


def make_conversation(
    db: Session,
    account: Account,
    *,
    label_number: int,
    texter_messages: int = 0,
    last_message_at: datetime | None = None,
    status: ConversationStatus = ConversationStatus.ACTIVE,
    texter: Texter | None = None,
) -> Conversation:
    now = datetime.now(UTC) - timedelta(hours=1)
    conversation = Conversation(
        texter_id=texter.id if texter else None,
        channel=Channel.WEB,
        label_number=label_number,
        status=status,
        assigned_account_id=account.id,
        opened_at=now,
        assigned_at=now,
        closed_at=now if status == ConversationStatus.CLOSED else None,
    )
    db.add(conversation)
    db.flush()
    for i in range(texter_messages):
        add_message(db, conversation, MessageSender.TEXTER, f"hi {i}", now + timedelta(seconds=i))
    if last_message_at is not None:
        conversation.last_message_at = last_message_at
    db.commit()
    return conversation


def add_report(db: Session, conversation: Conversation, account: Account) -> None:
    outcome = ReportOption(
        kind=ReportOptionKind.OUTCOME, label="Helped", display_order=0, is_active=True
    )
    db.add(outcome)
    db.flush()
    db.add(
        ConversationReport(
            conversation_id=conversation.id,
            account_id=account.id,
            outcome_id=outcome.id,
            confidence=4,
            submitted_at=datetime.now(UTC),
        )
    )
    db.commit()


def get_inbox(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/portal/inbox")
    assert response.status_code == 200
    return response.json()


def test_inbox_lists_only_my_conversations_newest_activity_first(
    db: Session, staff_client: TestClient, account: Account
) -> None:
    now = datetime.now(UTC)
    older = make_conversation(db, account, label_number=3, last_message_at=now - timedelta(hours=2))
    newer = make_conversation(db, account, label_number=7, last_message_at=now)
    queued = make_conversation(
        db,
        account,
        label_number=9,
        last_message_at=now - timedelta(minutes=1),
        status=ConversationStatus.QUEUED,
    )
    make_conversation(db, make_responder(db), label_number=8, last_message_at=now)

    items = get_inbox(staff_client)

    assert [item["conversation_id"] for item in items] == [
        str(newer.id),
        str(queued.id),
        str(older.id),
    ]
    assert [item["label"] for item in items] == ["Texter 7", "Texter 9", "Texter 3"]
    assert items[1]["status"] == "queued"


def test_missing_label_number_falls_back_to_plain_label(
    db: Session, staff_client: TestClient, account: Account
) -> None:
    conversation = make_conversation(db, account, label_number=1)
    conversation.label_number = None
    db.commit()

    assert get_inbox(staff_client)[0]["label"] == "Texter"


def test_unread_counts_texter_messages_and_drops_to_zero_after_reading(
    db: Session, staff_client: TestClient, account: Account
) -> None:
    conversation = make_conversation(db, account, label_number=1, texter_messages=3)
    add_message(db, conversation, MessageSender.RESPONDER, "hello", datetime.now(UTC))
    db.commit()

    # Never read: every texter message is unread, responder messages never are.
    assert get_inbox(staff_client)[0]["unread_count"] == 3

    response = staff_client.post(f"/api/portal/conversations/{conversation.id}/read")
    assert response.status_code == 204
    assert response.content == b""
    assert get_inbox(staff_client)[0]["unread_count"] == 0

    add_message(db, conversation, MessageSender.TEXTER, "still there?", datetime.now(UTC))
    db.commit()
    assert get_inbox(staff_client)[0]["unread_count"] == 1


def test_closed_conversation_stays_until_its_report_is_filed(
    db: Session, staff_client: TestClient, account: Account
) -> None:
    active = make_conversation(db, account, label_number=1)
    unreported = make_conversation(db, account, label_number=2, status=ConversationStatus.CLOSED)
    reported = make_conversation(db, account, label_number=3, status=ConversationStatus.CLOSED)
    add_report(db, reported, account)

    items = {item["conversation_id"]: item for item in get_inbox(staff_client)}

    assert set(items) == {str(active.id), str(unreported.id)}
    assert items[str(unreported.id)]["needs_report"] is True
    assert items[str(active.id)]["needs_report"] is False


def test_reading_another_responders_conversation_looks_like_a_missing_id(
    db: Session, staff_client: TestClient, published: list[tuple[str, Event]]
) -> None:
    theirs = make_conversation(db, make_responder(db), label_number=1, texter_messages=1)

    other = staff_client.post(f"/api/portal/conversations/{theirs.id}/read")
    missing = staff_client.post(f"/api/portal/conversations/{uuid.uuid4()}/read")

    assert other.status_code == missing.status_code == 404
    assert other.json() == missing.json()
    db.refresh(theirs)
    assert theirs.responder_last_read_at is None
    assert published == []


def test_off_shift_gets_403(db: Session, staff_client: TestClient, account: Account) -> None:
    conversation = make_conversation(db, account, label_number=1)
    end_shift_and_requeue(db, account, ShiftEndReason.MANUAL, datetime.now(UTC))
    db.commit()

    for response in (
        staff_client.get("/api/portal/inbox"),
        staff_client.post(f"/api/portal/conversations/{conversation.id}/read"),
    ):
        assert response.status_code == 403
        assert response.json()["code"] == "not_on_shift"


def test_read_publishes_conversation_updated_after_commit(
    db: Session, staff_client: TestClient, account: Account, published: list[tuple[str, Event]]
) -> None:
    conversation = make_conversation(db, account, label_number=1, texter_messages=2)
    before_commit: list[list[tuple[str, Event]]] = []

    def check_before_commit(session: Session) -> None:
        before_commit.append(list(published))

    sa_event.listen(db, "before_commit", check_before_commit)
    try:
        response = staff_client.post(f"/api/portal/conversations/{conversation.id}/read")
    finally:
        sa_event.remove(db, "before_commit", check_before_commit)

    assert response.status_code == 204
    assert before_commit[-1] == []
    assert published == [
        (
            portal_topic(account.id),
            {
                "type": CONVERSATION_UPDATED,
                "data": {"conversation_id": str(conversation.id), "unread_count": 0},
            },
        )
    ]


def test_inbox_query_count_does_not_grow_with_conversations(
    db: Session, staff_client: TestClient, account: Account, test_engine: Engine
) -> None:
    def count_queries() -> int:
        statements: list[str] = []

        def record(*args: Any) -> None:
            statements.append(args[2])

        sa_event.listen(test_engine, "before_cursor_execute", record)
        try:
            get_inbox(staff_client)
        finally:
            sa_event.remove(test_engine, "before_cursor_execute", record)
        return len(statements)

    make_conversation(db, account, label_number=1, texter_messages=2)
    one = count_queries()

    for n in range(2, 7):
        make_conversation(db, account, label_number=n, texter_messages=n)
    make_conversation(db, account, label_number=7, status=ConversationStatus.CLOSED)
    reported = make_conversation(db, account, label_number=8, status=ConversationStatus.CLOSED)
    add_report(db, reported, account)
    assert len(get_inbox(staff_client)) == 7
    many = count_queries()

    assert one > 0
    assert many == one


def test_no_field_identifies_the_texter(
    db: Session,
    staff_client: TestClient,
    account: Account,
    texter: Texter,
    published: list[tuple[str, Event]],
) -> None:
    conversation = make_conversation(db, account, label_number=1, texter_messages=1, texter=texter)
    make_conversation(db, account, label_number=2, status=ConversationStatus.CLOSED, texter=texter)

    response = staff_client.get("/api/portal/inbox")
    staff_client.post(f"/api/portal/conversations/{conversation.id}/read")

    items = response.json()
    assert len(items) == 2
    for item in items:
        assert set(item) == INBOX_FIELDS
    payloads = [response.text] + [str(e) for _, e in published]
    for payload in payloads:
        lowered = payload.lower()
        assert "texter_id" not in lowered
        assert "hash" not in lowered
        assert str(texter.id) not in lowered
        assert IDENTITY_HASH.hex() not in lowered
