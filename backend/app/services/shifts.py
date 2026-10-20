from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

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
