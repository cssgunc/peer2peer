from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events import SHIFT_ENDED, portal_topic, publish_after_commit
from app.models.account import Account
from app.models.messaging import Conversation, ConversationStatus
from app.models.shift import Shift, ShiftEndReason

HEARTBEAT_TIMEOUT = timedelta(seconds=90)


def start_shift(db, account, now) -> Shift:
    open_shift_query = select(Shift).where(
        Shift.account_id == account.id,
        Shift.ended_at.is_(None),
    )
    open_shift = db.scalar(open_shift_query)

    if open_shift is not None:
        return open_shift

    shift = Shift(
        account_id=account.id,
        started_at=now,
        last_heartbeat_at=now,
    )

    db.add(shift)
    db.flush()
    return shift


def end_shift(db: Session, shift: Shift, reason: ShiftEndReason, now) -> None:
    shift.last_heartbeat_at = now
    shift.ended_at = now
    shift.ended_reason = reason


def end_shift_and_requeue(
    db: Session, account: Account, reason: ShiftEndReason, now: datetime
) -> None:
    """End the open shift and hand the account's active conversations to someone else."""
    # Imported here because assignment imports this module.
    from app.services.assignment import assign_conversation, notify_assigned

    shift = get_open_shift(db, account.id)
    if shift is None:
        return
    end_shift(db, shift, reason, now)
    publish_after_commit(
        db,
        portal_topic(account.id),
        {"type": SHIFT_ENDED, "data": {"shift_id": str(shift.id), "reason": reason.value}},
    )

    # Closed conversations awaiting a report stay with the responder.
    active = db.scalars(
        select(Conversation)
        .where(
            Conversation.assigned_account_id == account.id,
            Conversation.status == ConversationStatus.ACTIVE,
        )
        .order_by(Conversation.opened_at, Conversation.id)
        .with_for_update()
    ).all()
    for conversation in active:
        conversation.status = ConversationStatus.QUEUED
        conversation.assigned_account_id = None
        conversation.assigned_at = None
    for conversation in active:
        assignee = assign_conversation(db, conversation, now)
        if assignee is not None:
            notify_assigned(db, conversation, assignee)


def get_open_shift(db, account_id) -> Shift | None:
    open_shift_query = select(Shift).where(
        Shift.account_id == account_id,
        Shift.ended_at.is_(None),
    )

    open_shift = db.scalar(open_shift_query)
    return open_shift


def record_heartbeat(db, shift: Shift, now) -> None:
    shift.last_heartbeat_at = now


def online_shifts(db: Session, now: datetime) -> list[Shift]:
    cutoff = now - HEARTBEAT_TIMEOUT
    statement = select(Shift).where(
        Shift.ended_at.is_(None),
        Shift.last_heartbeat_at >= cutoff,
        Shift.last_heartbeat_at <= now,
    )
    return list(db.scalars(statement).all())


def is_line_online(db, now) -> bool:
    return bool(online_shifts(db, now))
