from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Account, AuthSession, ShiftEndReason
from app.services.sessions import revoke_session
from app.services.shifts import end_shift_and_requeue


def close_idle_sessions(db: Session, now: datetime) -> int:
    """Revoke idle sessions and end their shifts, matching request-time idle expiry."""
    cutoff = now - timedelta(minutes=get_settings().session_idle_minutes)
    sessions = db.scalars(
        select(AuthSession)
        .where(AuthSession.revoked_at.is_(None), AuthSession.last_seen_at <= cutoff)
        .order_by(AuthSession.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    for session in sessions:
        revoke_session(db, session, now)
        account = db.get(Account, session.account_id)
        assert account is not None  # Required by the session's foreign key.
        end_shift_and_requeue(db, account, ShiftEndReason.IDLE, now)
    db.flush()
    return len(sessions)
