"""Assign queued conversations without committing or publishing events."""

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.messaging import Conversation, ConversationStatus
from app.services.shifts import online_shifts


def eligible_responders(db: Session, now: datetime) -> list[Account]:
    """Active staff with an open shift and a current heartbeat."""
    account_ids = [shift.account_id for shift in online_shifts(db, now)]
    return list(
        db.scalars(select(Account).where(Account.id.in_(account_ids), Account.is_active.is_(True)))
    )


def assign_conversation(db: Session, conversation: Conversation, now: datetime) -> Account | None:
    """Assign a queued conversation; locks last until the caller ends its transaction.

    Locked conversations or responders are skipped so parallel workers can make progress.
    """
    db.flush()
    queued = db.scalar(
        select(Conversation)
        .where(
            Conversation.id == conversation.id,
            Conversation.status == ConversationStatus.QUEUED,
        )
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)
    )
    if queued is None:
        return None

    responders = eligible_responders(db, now)
    # Lock before reading workloads, in a stable order. A separate workload query
    # sees assignments committed before these locks were acquired (READ COMMITTED).
    locked_ids = list(
        db.scalars(
            select(Account.id)
            .where(Account.id.in_([account.id for account in responders]))
            .order_by(Account.id)
            .with_for_update(skip_locked=True)
        )
    )
    if not locked_ids:
        return None

    active_count = (
        select(func.count(Conversation.id))
        .where(
            Conversation.assigned_account_id == Account.id,
            Conversation.status == ConversationStatus.ACTIVE,
        )
        .correlate(Account)
        .scalar_subquery()
    )
    last_assigned = (
        select(func.max(Conversation.assigned_at))
        .where(Conversation.assigned_account_id == Account.id)
        .correlate(Account)
        .scalar_subquery()
    )
    # An optional per-responder conversation cap would be applied here.
    account = db.scalars(
        select(Account)
        .where(Account.id.in_(locked_ids))
        .order_by(active_count, last_assigned.asc().nulls_first(), Account.id)
        .limit(1)
    ).one()
    queued.assigned_account_id = account.id
    queued.assigned_at = now
    queued.status = ConversationStatus.ACTIVE
    db.flush()
    return account


def assign_queued(db: Session, now: datetime) -> list[Conversation]:
    """Drain the queue oldest first, skipping rows owned by other workers."""
    db.flush()
    assigned: list[Conversation] = []
    while True:
        conversation = db.scalar(
            select(Conversation)
            .where(Conversation.status == ConversationStatus.QUEUED)
            .order_by(Conversation.opened_at, Conversation.id)
            .limit(1)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        if conversation is None or assign_conversation(db, conversation, now) is None:
            return assigned
        assigned.append(conversation)
