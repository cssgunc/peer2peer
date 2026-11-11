from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, AuthSession
from app.security.passwords import hash_password, verify_password
from app.services.sessions import SESSION_COOKIE_NAME, _hash, issue_session

TEMPORARY = "Temporary-Pass-8kQ2"
NEW = "A distinct! password 2026"


@pytest.fixture(scope="module")
def temporary_hash() -> str:
    return hash_password(TEMPORARY)


@pytest.fixture
def account(db: Session, temporary_hash: str) -> Account:
    # Fresh from a coordinator: the temporary password must be replaced before anything else.
    account = Account(
        email="staff@unc.edu",
        display_name="Test staff",
        password_hash=temporary_hash,
        role=AccountRole.COORDINATOR,
        must_change_password=True,
    )
    db.add(account)
    db.flush()
    return account


def sign_in_as(db: Session, client: TestClient, account: Account) -> str:
    token = issue_session(db, account, datetime.now(UTC))
    db.commit()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return token


def session_row(db: Session, token: str) -> AuthSession:
    session = db.query(AuthSession).filter_by(token_hash=_hash(token)).one()
    db.refresh(session)
    return session


def change(client: TestClient, current: str = TEMPORARY, new: str = NEW):
    return client.post(
        "/api/auth/password", json={"current_password": current, "new_password": new}
    )


def test_success_clears_flag_and_ends_other_sessions_only(
    db: Session, client: TestClient, account: Account
) -> None:
    other = issue_session(db, account, datetime.now(UTC))
    current = sign_in_as(db, client, account)

    response = change(client)

    assert response.status_code == 204
    db.refresh(account)
    assert account.must_change_password is False
    assert verify_password(NEW, account.password_hash)
    assert not verify_password(TEMPORARY, account.password_hash)
    assert session_row(db, other).revoked_at is not None
    assert session_row(db, current).revoked_at is None
    # The current session keeps working, now past the gate.
    assert client.get("/api/auth/me").json()["must_change_password"] is False
    assert client.get("/api/admin/accounts").status_code == 200


def test_staff_can_change_password_without_the_flag(
    db: Session, client: TestClient, account: Account
) -> None:
    account.must_change_password = False
    sign_in_as(db, client, account)

    assert change(client).status_code == 204
    db.refresh(account)
    assert verify_password(NEW, account.password_hash)


def test_wrong_current_password_changes_nothing(
    db: Session, client: TestClient, account: Account, temporary_hash: str
) -> None:
    other = issue_session(db, account, datetime.now(UTC))
    sign_in_as(db, client, account)

    response = change(client, current="not the password")

    assert response.status_code == 400
    assert response.json()["code"] == "wrong_password"
    db.refresh(account)
    assert account.password_hash == temporary_hash
    assert account.must_change_password is True
    assert session_row(db, other).revoked_at is None


@pytest.mark.parametrize(
    ("new", "reason"),
    [
        ("short", "at least 12 characters"),
        ("unbelievable", "too common"),
        ("staff-and-more-words", "can't contain your email"),
        (TEMPORARY, "different from your current password"),
    ],
)
def test_weak_new_password_is_rejected_with_reasons(
    db: Session,
    client: TestClient,
    account: Account,
    temporary_hash: str,
    new: str,
    reason: str,
) -> None:
    sign_in_as(db, client, account)

    response = change(client, new=new)

    assert response.status_code == 422
    assert response.json()["code"] == "weak_password"
    assert reason in response.json()["detail"]
    db.refresh(account)
    assert account.password_hash == temporary_hash
    assert account.must_change_password is True


def test_flagged_account_is_limited_to_me_password_and_sign_out(
    db: Session, client: TestClient, account: Account
) -> None:
    sign_in_as(db, client, account)

    for method, path in [
        ("GET", "/api/admin/accounts"),
        ("GET", "/api/portal/guide"),
        ("POST", "/api/portal/shift/start"),
    ]:
        response = client.request(method, path)
        assert response.status_code == 403, path
        assert response.json()["code"] == "password_change_required"

    assert client.get("/api/auth/me").json()["must_change_password"] is True
    assert client.post("/api/auth/sign-out").status_code == 204


def test_change_password_requires_a_session(client: TestClient) -> None:
    assert change(client).status_code == 401


def test_change_password_is_rate_limited_per_account(
    db: Session, client: TestClient, account: Account
) -> None:
    sign_in_as(db, client, account)
    for _ in range(5):
        assert change(client, current="wrong guess").status_code == 400

    response = change(client)

    assert response.status_code == 429
    assert "Retry-After" in response.headers
