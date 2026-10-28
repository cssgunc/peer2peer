import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, delete, select, text
from sqlalchemy.orm import Session

from app.models.account import Account, AccountRole
from app.models.messaging import Channel, Conversation, ConversationStatus
from app.models.shift import Shift, ShiftEndReason
from app.services.assignment import assign_conversation, assign_queued, eligible_responders
from app.services.shifts import HEARTBEAT_TIMEOUT, start_shift

NOW = datetime(2026, 1, 1, 12, tzinfo=UTC)


def make_responder(db: Session, *, online: bool = True) -> Account:
    account = Account(
        email=f"{uuid.uuid4()}@unc.edu",
        display_name="Test responder",
        password_hash="placeholder-not-a-real-password-hash",
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.flush()
    if online:
        start_shift(db, account, NOW)
    return account


def make_conversation(
    db: Session,
    *,
    opened_at: datetime = NOW,
    account: Account | None = None,
    assigned_at: datetime | None = None,
    status: ConversationStatus = ConversationStatus.QUEUED,
) -> Conversation:
    conversation = Conversation(
        channel=Channel.WEB,
        opened_at=opened_at,
        status=status,
        assigned_account_id=account.id if account else None,
        assigned_at=assigned_at,
        closed_at=NOW if status == ConversationStatus.CLOSED else None,
    )
    db.add(conversation)
    db.flush()
    return conversation


def test_no_responder_leaves_conversation_queued(db: Session) -> None:
    conversation = make_conversation(db)

    assert assign_conversation(db, conversation, NOW) is None
    db.refresh(conversation)
    assert conversation.status == ConversationStatus.QUEUED
    assert conversation.assigned_account_id is None
    assert conversation.assigned_at is None


def test_one_responder_gets_everything_without_a_cap(db: Session) -> None:
    account = make_responder(db)
    conversations = [make_conversation(db) for _ in range(10)]

    for conversation in conversations:
        assert assign_conversation(db, conversation, NOW) == account
        db.refresh(conversation)
        assert conversation.assigned_account_id == account.id
        assert conversation.assigned_at == NOW
        assert conversation.status == ConversationStatus.ACTIVE


def test_fewer_active_conversations_wins_over_assignment_age(db: Session) -> None:
    busy = make_responder(db)
    available = make_responder(db)
    for _ in range(2):
        make_conversation(
            db, account=busy, status=ConversationStatus.ACTIVE, assigned_at=NOW - timedelta(hours=2)
        )
    make_conversation(db, account=available, status=ConversationStatus.ACTIVE, assigned_at=NOW)

    assert assign_conversation(db, make_conversation(db), NOW) == available


def test_tie_uses_most_recent_assignment_including_closed_conversations(db: Session) -> None:
    recent = make_responder(db)
    older = make_responder(db)
    for account, age in [(recent, 3), (recent, 1), (older, 2)]:
        make_conversation(
            db,
            account=account,
            status=ConversationStatus.CLOSED,
            assigned_at=NOW - timedelta(hours=age),
        )

    assert assign_conversation(db, make_conversation(db), NOW) == older


def test_never_assigned_wins_tie(db: Session) -> None:
    previous = make_responder(db)
    new = make_responder(db)
    make_conversation(
        db, account=previous, status=ConversationStatus.CLOSED, assigned_at=NOW - timedelta(days=1)
    )

    assert assign_conversation(db, make_conversation(db), NOW) == new


@pytest.mark.parametrize("ineligible", ["stale", "deactivated", "ended", "no_shift", "future"])
def test_ineligible_accounts_are_skipped(db: Session, ineligible: str) -> None:
    excluded = make_responder(db, online=ineligible != "no_shift")
    eligible = make_responder(db)
    shift = db.scalar(select(Shift).where(Shift.account_id == excluded.id))
    if ineligible == "deactivated":
        excluded.is_active = False
    elif ineligible == "stale":
        assert shift is not None
        shift.last_heartbeat_at = NOW - HEARTBEAT_TIMEOUT - timedelta(microseconds=1)
    elif ineligible == "ended":
        assert shift is not None
        shift.ended_at = NOW
        shift.ended_reason = ShiftEndReason.MANUAL
    elif ineligible == "future":
        assert shift is not None
        shift.last_heartbeat_at = NOW + timedelta(seconds=1)
    db.flush()

    assert eligible_responders(db, NOW) == [eligible]
    assert assign_conversation(db, make_conversation(db), NOW) == eligible


def test_heartbeat_exactly_90_seconds_old_is_eligible(db: Session) -> None:
    account = make_responder(db)
    shift = db.scalars(select(Shift).where(Shift.account_id == account.id)).one()
    shift.last_heartbeat_at = NOW - HEARTBEAT_TIMEOUT
    db.flush()

    assert eligible_responders(db, NOW) == [account]


def test_closed_conversations_do_not_count_as_active(db: Session) -> None:
    busy = make_responder(db)
    available = make_responder(db)
    make_conversation(db, account=busy, status=ConversationStatus.ACTIVE, assigned_at=NOW)
    for _ in range(3):
        make_conversation(db, account=available, status=ConversationStatus.CLOSED, assigned_at=NOW)

    assert assign_conversation(db, make_conversation(db), NOW) == available


def test_assign_queued_orders_by_opened_at_and_balances(db: Session) -> None:
    accounts = [make_responder(db), make_responder(db)]
    conversations = [
        make_conversation(db, opened_at=NOW - timedelta(minutes=age)) for age in [2, 3, 1, 4]
    ]
    existing = make_conversation(db, status=ConversationStatus.CLOSED)

    assigned = assign_queued(db, NOW)

    assert assigned == sorted(conversations, key=lambda conversation: conversation.opened_at)
    for account in accounts:
        assert sum(conversation.assigned_account_id == account.id for conversation in assigned) == 2
    assert existing.status == ConversationStatus.CLOSED
    assert assign_queued(db, NOW) == []


def test_assign_queued_without_responders_preserves_queue(db: Session) -> None:
    conversations = [make_conversation(db) for _ in range(3)]

    assert assign_queued(db, NOW) == []
    for conversation in conversations:
        db.refresh(conversation)
        assert conversation.status == ConversationStatus.QUEUED


@pytest.mark.parametrize("status", [ConversationStatus.ACTIVE, ConversationStatus.CLOSED])
def test_does_not_reassign_nonqueued_conversations(db: Session, status: ConversationStatus) -> None:
    account = make_responder(db)
    make_responder(db)
    conversation = make_conversation(db, account=account, assigned_at=NOW, status=status)

    assert assign_conversation(db, conversation, NOW + timedelta(seconds=1)) is None
    db.refresh(conversation)
    assert conversation.status == status
    assert conversation.assigned_account_id == account.id
    assert conversation.assigned_at == NOW


def test_assignments_can_be_rolled_back_by_caller(db: Session) -> None:
    make_responder(db)
    conversation = make_conversation(db)

    transaction = db.begin_nested()
    assert assign_queued(db, NOW) == [conversation]
    transaction.rollback()
    db.refresh(conversation)

    assert conversation.status == ConversationStatus.QUEUED
    assert conversation.assigned_account_id is None
    assert conversation.assigned_at is None


@pytest.fixture
def concurrent_data(
    _schema: None, test_engine: Engine
) -> Iterator[tuple[list[uuid.UUID], list[uuid.UUID]]]:
    # Independent connections need committed fixtures to exercise PostgreSQL locks.
    with Session(test_engine) as setup:
        accounts = [make_responder(setup), make_responder(setup)]
        conversations = [
            make_conversation(setup, opened_at=NOW - timedelta(minutes=age)) for age in [2, 1]
        ]
        account_ids = [account.id for account in accounts]
        conversation_ids = [conversation.id for conversation in conversations]
        setup.commit()
    try:
        yield account_ids, conversation_ids
    finally:
        with Session(test_engine) as cleanup, cleanup.begin():
            cleanup.execute(delete(Conversation).where(Conversation.id.in_(conversation_ids)))
            cleanup.execute(delete(Shift).where(Shift.account_id.in_(account_ids)))
            cleanup.execute(delete(Account).where(Account.id.in_(account_ids)))


def test_assign_queued_skips_locked_conversations(
    test_engine: Engine, concurrent_data: tuple[list[uuid.UUID], list[uuid.UUID]]
) -> None:
    _, conversation_ids = concurrent_data
    with Session(test_engine) as first, Session(test_engine) as second:
        first.scalar(
            select(Conversation).where(Conversation.id == conversation_ids[0]).with_for_update()
        )
        # Fail quickly if SKIP LOCKED regresses into a blocking row lock.
        second.execute(text("SET LOCAL lock_timeout = '1s'"))
        assigned = assign_queued(second, NOW)

        assert [conversation.id for conversation in assigned] == [conversation_ids[1]]


def test_assignment_skips_locked_responder(
    test_engine: Engine, concurrent_data: tuple[list[uuid.UUID], list[uuid.UUID]]
) -> None:
    account_ids, conversation_ids = concurrent_data
    with Session(test_engine) as first, Session(test_engine) as second:
        first.scalar(select(Account).where(Account.id == account_ids[0]).with_for_update())
        second.execute(text("SET LOCAL lock_timeout = '1s'"))
        conversation = second.get(Conversation, conversation_ids[0])
        assert conversation is not None
        account = assign_conversation(second, conversation, NOW)

        assert account is not None
        assert account.id == account_ids[1]
