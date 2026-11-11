from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import AppError
from app.models import Account, AccountRole, AuthSession
from app.services.sessions import SESSION_COOKIE_NAME, resolve_session
from app.services.shifts import get_open_shift


def get_current_session(request: Request, db: Annotated[Session, Depends(get_db)]) -> AuthSession:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    session = resolve_session(db, token, datetime.now(UTC))
    # Commit before raising so an idle or expired session's revoke and the last_seen_at bump persist
    db.commit()
    if session is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return session


def get_current_account(
    session: Annotated[AuthSession, Depends(get_current_session)],
    db: Annotated[Session, Depends(get_db)],
) -> Account:
    """The signed-in account, even one that still has to change its password.

    Only GET /api/auth/me and POST /api/auth/password use this directly; everything else goes
    through require_staff.
    """
    account = db.get(Account, session.account_id)
    if account is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return account


def require_staff(account: Annotated[Account, Depends(get_current_account)]) -> Account:
    # A temporary password was seen by a coordinator, so it unlocks nothing until replaced.
    if account.must_change_password:
        raise AppError(403, "password_change_required", "Change your password to continue.")
    return account


def require_coordinator(account: Annotated[Account, Depends(require_staff)]) -> Account:
    if account.role != AccountRole.COORDINATOR:
        raise HTTPException(status_code=403, detail="Coordinator access required")
    return account


def require_on_shift(
    account: Annotated[Account, Depends(require_staff)], db: Annotated[Session, Depends(get_db)]
) -> Account:
    if get_open_shift(db, account.id) is None:
        raise AppError(403, "not_on_shift", "Start a shift to access conversations.")
    return account
