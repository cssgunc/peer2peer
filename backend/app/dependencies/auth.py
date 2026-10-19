from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, AccountRole, AuthSession
from app.services.sessions import SESSION_COOKIE_NAME, resolve_session


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


def require_staff(
    session: Annotated[AuthSession, Depends(get_current_session)],
    db: Annotated[Session, Depends(get_db)],
) -> Account:
    account = db.get(Account, session.account_id)
    if account is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return account


def require_coordinator(account: Annotated[Account, Depends(require_staff)]) -> Account:
    if account.role != AccountRole.COORDINATOR:
        raise HTTPException(status_code=403, detail="Coordinator access required")
    return account
