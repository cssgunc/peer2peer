from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, FastAPI, Response
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies.auth import require_coordinator, require_staff
from app.errors import register_exception_handlers
from app.models import Account, AccountRole, AuthSession
from app.services.sessions import (
    SESSION_COOKIE_NAME,
    clear_session_cookie,
    issue_session,
    resolve_session,
    revoke_all_sessions,
    revoke_session,
    set_session_cookie,
)

NOW = datetime(2026, 10, 19, 14, 0, tzinfo=UTC)


def make_account(
    db: Session, email: str = "staff@unc.edu", role: AccountRole = AccountRole.RESPONDER
) -> Account:
    account = Account(
        email=email,
        display_name="Test staff",
        password_hash="placeholder-not-a-real-password-hash",
        role=role,
    )
    db.add(account)
    db.flush()
    return account


def session_for(db: Session, token: str) -> AuthSession:
    session = resolve_session(db, token, NOW)
    assert session is not None
    return session


def test_valid_session_resolves(db: Session) -> None:
    account = make_account(db)
    token = issue_session(db, account, NOW)

    session = session_for(db, token)
    assert session.account_id == account.id
    assert session.expires_at == NOW + timedelta(hours=get_settings().session_max_hours)


def test_unknown_token_does_not_resolve(db: Session) -> None:
    assert resolve_session(db, "not-a-real-token", NOW) is None


def test_revoked_session_does_not_resolve(db: Session) -> None:
    token = issue_session(db, make_account(db), NOW)
    revoke_session(db, session_for(db, token), NOW)

    assert resolve_session(db, token, NOW + timedelta(seconds=1)) is None


def test_expired_session_does_not_resolve_and_is_revoked(db: Session) -> None:
    token = issue_session(db, make_account(db), NOW)
    session = session_for(db, token)
    # Keep it active so only the absolute cap applies.
    session.last_seen_at = session.expires_at - timedelta(minutes=1)
    db.flush()

    assert resolve_session(db, token, session.expires_at) is None
    assert session.revoked_at == session.expires_at


def test_idle_session_does_not_resolve_and_is_revoked(db: Session) -> None:
    account = make_account(db)
    idle_at = NOW + timedelta(minutes=get_settings().session_idle_minutes)
    almost_idle = issue_session(db, account, NOW)
    idle = issue_session(db, account, NOW)

    assert resolve_session(db, almost_idle, idle_at - timedelta(seconds=1)) is not None
    assert resolve_session(db, idle, idle_at) is None
    session = db.scalars(select(AuthSession).where(AuthSession.revoked_at.is_not(None))).one()
    assert session.revoked_at == idle_at


def test_deactivated_account_session_does_not_resolve(db: Session) -> None:
    account = make_account(db)
    token = issue_session(db, account, NOW)
    account.is_active = False
    db.flush()

    assert resolve_session(db, token, NOW) is None


def test_last_seen_at_is_not_written_twice_within_a_minute(db: Session) -> None:
    token = issue_session(db, make_account(db), NOW)

    session = session_for(db, token)
    assert resolve_session(db, token, NOW + timedelta(seconds=30)) is session
    assert session.last_seen_at == NOW
    assert resolve_session(db, token, NOW + timedelta(seconds=60)) is session
    assert session.last_seen_at == NOW

    assert resolve_session(db, token, NOW + timedelta(seconds=61)) is session
    assert session.last_seen_at == NOW + timedelta(seconds=61)


def test_revoke_all_sessions_keeps_the_excepted_session(db: Session) -> None:
    account = make_account(db)
    other = make_account(db, "other@unc.edu")
    kept = session_for(db, issue_session(db, account, NOW))
    revoked = session_for(db, issue_session(db, account, NOW))
    unrelated = session_for(db, issue_session(db, other, NOW))

    revoke_all_sessions(db, account.id, NOW, except_session_id=kept.id)

    assert kept.revoked_at is None
    assert revoked.revoked_at == NOW
    assert unrelated.revoked_at is None


def test_raw_token_is_not_stored_in_the_row(db: Session) -> None:
    token = issue_session(db, make_account(db), NOW)
    session = session_for(db, token)
    db.expire(session)

    for column in inspect(AuthSession).columns:
        value = getattr(session, column.key)
        assert token not in str(value)
        if isinstance(value, bytes):
            assert token.encode() not in value


def test_session_cookie_attributes() -> None:
    response = Response()
    set_session_cookie(response, "token-value")
    header = response.headers["set-cookie"]
    assert header.startswith(f"{SESSION_COOKIE_NAME}=token-value;")
    assert "HttpOnly" in header
    assert "SameSite=strict" in header
    assert "Path=/" in header
    assert f"Max-Age={get_settings().session_max_hours * 3600}" in header

    response = Response()
    clear_session_cookie(response)
    header = response.headers["set-cookie"]
    assert header.startswith(f'{SESSION_COOKIE_NAME}="";')
    assert "Max-Age=0" in header


router = APIRouter()


@router.get("/staff")
def staff_route(account: Annotated[Account, Depends(require_staff)]) -> dict[str, str]:
    return {"id": str(account.id)}


@router.get("/coordinator")
def coordinator_route(account: Annotated[Account, Depends(require_coordinator)]) -> dict[str, str]:
    return {"id": str(account.id)}


@pytest.fixture
def auth_client(db: Session) -> Iterator[TestClient]:
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router)

    def override_get_db() -> Iterator[Session]:
        # Like the real get_db closing its session: anything the request didn't commit is lost.
        try:
            yield db
        finally:
            db.rollback()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as client:
        yield client


def signed_in(db: Session, client: TestClient, account: Account, now: datetime) -> None:
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, account, now))
    # Committing releases the test's savepoint, so the request's rollback can't undo the setup.
    db.commit()


def test_no_cookie_gives_401(auth_client: TestClient) -> None:
    r = auth_client.get("/staff")
    assert r.status_code == 401
    assert r.json()["code"] == "not_authenticated"


def test_staff_route_returns_the_account(db: Session, auth_client: TestClient) -> None:
    account = make_account(db)
    signed_in(db, auth_client, account, datetime.now(UTC))

    r = auth_client.get("/staff")
    assert r.status_code == 200
    assert r.json() == {"id": str(account.id)}


def test_responder_on_coordinator_route_gives_403(db: Session, auth_client: TestClient) -> None:
    signed_in(db, auth_client, make_account(db), datetime.now(UTC))

    r = auth_client.get("/coordinator")
    assert r.status_code == 403
    assert r.json()["code"] == "forbidden"


def test_coordinator_on_coordinator_route_is_allowed(db: Session, auth_client: TestClient) -> None:
    signed_in(db, auth_client, make_account(db, role=AccountRole.COORDINATOR), datetime.now(UTC))

    assert auth_client.get("/coordinator").status_code == 200


def test_idle_session_revoke_is_saved_before_the_401(db: Session, auth_client: TestClient) -> None:
    account = make_account(db)
    idle = timedelta(minutes=get_settings().session_idle_minutes + 1)
    signed_in(db, auth_client, account, datetime.now(UTC) - idle)

    r = auth_client.get("/staff")
    assert r.status_code == 401

    # Expire cached state so the check reads what the dependency actually committed.
    db.expire_all()
    session = db.scalars(select(AuthSession).where(AuthSession.account_id == account.id)).one()
    assert session.revoked_at is not None
