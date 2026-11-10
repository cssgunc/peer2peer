from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Shift, ShiftEndReason
from app.services.shifts import end_shift_and_requeue

LOST_HEARTBEAT_TIMEOUT = timedelta(minutes=5)


def close_lost_shifts(db: Session, now: datetime) -> int:
    """End open shifts whose last heartbeat is strictly more than five minutes old."""
    shifts = db.scalars(
        select(Shift)
        .where(Shift.ended_at.is_(None), Shift.last_heartbeat_at < now - LOST_HEARTBEAT_TIMEOUT)
        .order_by(Shift.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    for shift in shifts:
        account = db.get(Account, shift.account_id)
        assert account is not None  # Required by the shift's foreign key.
        end_shift_and_requeue(db, account, ShiftEndReason.HEARTBEAT_LOST, now)
    db.flush()
    return len(shifts)
