"""Server-side staff sessions (TDD 4.5.1, 4.6.1).

The browser holds a random token in an HttpOnly cookie; only its SHA-256 is stored. Never log the
raw token, the cookie value, or the hash.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from fastapi import Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Account, AuthSession

SESSION_COOKIE_NAME = "p2p_session"
# Bump last_seen_at at most this often, so authenticated requests don't all write.
LAST_SEEN_THROTTLE = timedelta(seconds=60)


def _hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def issue_session(db: Session, account: Account, now: datetime) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            account_id=account.id,
            token_hash=_hash(token),
            last_seen_at=now,
            expires_at=now + timedelta(hours=get_settings().session_max_hours),
        )
    )
    db.flush()
    return token


def resolve_session(db: Session, raw_token: str, now: datetime) -> AuthSession | None:
    row = db.execute(
        select(AuthSession, Account)
        .join(Account, Account.id == AuthSession.account_id)
        .where(AuthSession.token_hash == _hash(raw_token))
    ).first()
    if row is None:
        return None
    session, account = row
    if session.revoked_at is not None:
        return None

    idle_window = timedelta(minutes=get_settings().session_idle_minutes)
    if session.expires_at <= now or now - session.last_seen_at >= idle_window:
        # TODO: an idle session must also end the account's open shift (TDD 4.6.1).
        revoke_session(db, session, now)
        return None
    if not account.is_active:
        return None

    if now - session.last_seen_at > LAST_SEEN_THROTTLE:
        session.last_seen_at = now
        db.flush()
    return session


def revoke_session(db: Session, session: AuthSession, now: datetime) -> None:
    if session.revoked_at is None:
        session.revoked_at = now
        db.flush()


def revoke_all_sessions(
    db: Session,
    account_id: uuid.UUID,
    now: datetime,
    except_session_id: uuid.UUID | None = None,
) -> None:
    stmt = (
        update(AuthSession)
        .where(AuthSession.account_id == account_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    if except_session_id is not None:
        stmt = stmt.where(AuthSession.id != except_session_id)
    db.execute(stmt, execution_options={"synchronize_session": "fetch"})


def _cookie_options() -> dict:
    return {
        "path": "/",
        "httponly": True,
        "samesite": "strict",
        "secure": get_settings().session_cookie_secure,
    }


def set_session_cookie(response: Response, token: str) -> None:
    max_age = get_settings().session_max_hours * 3600
    response.set_cookie(SESSION_COOKIE_NAME, token, max_age=max_age, **_cookie_options())


def clear_session_cookie(response: Response) -> None:
    # Same attributes as when setting, or browsers keep the original cookie.
    response.delete_cookie(SESSION_COOKIE_NAME, **_cookie_options())
