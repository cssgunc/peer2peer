import logging
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Account, AccountRole, AuditLog, Shift
from app.routers.admin import accounts as accounts_router
from app.security.passwords import verify_password
from app.services.sessions import SESSION_COOKIE_NAME, issue_session

URL = "/api/admin/accounts"
NEW_STAFF = {"email": "new.staff@unc.edu", "display_name": "New Staff", "role": "responder"}


def make_account(
    db: Session,
    email: str,
    display_name: str = "Test staff",
    role: AccountRole = AccountRole.RESPONDER,
    is_active: bool = True,
) -> Account:
    account = Account(
        email=email,
        display_name=display_name,
        password_hash="placeholder-not-a-real-password-hash",
        role=role,
        is_active=is_active,
    )
    db.add(account)
    db.flush()
    return account


def sign_in(db: Session, client: TestClient, account: Account) -> None:
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, account, datetime.now(UTC)))
    db.commit()


@pytest.fixture
def coordinator(db: Session, client: TestClient) -> Account:
    account = make_account(
        db, "coordinator@unc.edu", display_name="Coordinator", role=AccountRole.COORDINATOR
    )
    sign_in(db, client, account)
    return account


def create(client: TestClient, **overrides: str) -> dict:
    response = client.post(URL, json={**NEW_STAFF, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


# --- access ---------------------------------------------------------------------------------


@pytest.mark.parametrize(("method", "body"), [("GET", None), ("POST", NEW_STAFF)])
def test_anonymous_requests_get_401(client: TestClient, method: str, body: dict | None) -> None:
    response = client.request(method, URL, json=body)

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


@pytest.mark.parametrize(("method", "body"), [("GET", None), ("POST", NEW_STAFF)])
def test_responders_get_403(
    db: Session, client: TestClient, method: str, body: dict | None
) -> None:
    sign_in(db, client, make_account(db, "responder@unc.edu"))

    response = client.request(method, URL, json=body)

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
    assert db.scalar(select(func.count()).select_from(Account)) == 1  # nothing created


def test_there_is_no_delete_route(client: TestClient, coordinator: Account) -> None:
    response = client.delete(f"{URL}/{coordinator.id}")

    assert response.status_code in (404, 405)


# --- create ---------------------------------------------------------------------------------


def test_create_returns_a_working_temporary_password(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    response = client.post(URL, json=NEW_STAFF)

    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "no-store"
    body = response.json()
    password = body.pop("temporary_password")
    assert body == {
        "id": body["id"],
        "email": "new.staff@unc.edu",
        "display_name": "New Staff",
        "role": "responder",
        "is_active": True,
        "last_login_at": None,
        "on_shift": False,
    }

    account = db.scalar(select(Account).where(Account.email == "new.staff@unc.edu"))
    assert account is not None
    assert str(account.id) == body["id"]
    assert account.must_change_password is True
    assert account.password_hash != password
    assert verify_password(password, account.password_hash)


def test_each_account_gets_a_different_password(client: TestClient, coordinator: Account) -> None:
    first = create(client, email="first@unc.edu")["temporary_password"]
    second = create(client, email="second@unc.edu")["temporary_password"]

    assert first != second


def test_can_create_a_coordinator(client: TestClient, coordinator: Account) -> None:
    assert create(client, role="coordinator")["role"] == "coordinator"


def test_duplicate_email_in_a_different_case_gives_409(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    create(client, email="new.staff@unc.edu")

    response = client.post(URL, json={**NEW_STAFF, "email": "NEW.Staff@unc.edu"})

    assert response.status_code == 409
    assert response.json()["code"] == "email_taken"
    assert db.scalar(select(func.count()).select_from(Account)) == 2  # coordinator + first


@pytest.mark.parametrize(
    "overrides",
    [
        {"email": "not-an-email"},
        {"display_name": "   "},
        {"display_name": "x" * 101},
        {"role": "admin"},
    ],
    ids=["bad-email", "blank-name", "long-name", "unknown-role"],
)
def test_invalid_input_gives_422(
    client: TestClient, coordinator: Account, overrides: dict[str, str]
) -> None:
    response = client.post(URL, json={**NEW_STAFF, **overrides})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_any_domain_is_allowed_by_default(client: TestClient, coordinator: Account) -> None:
    assert get_settings().staff_email_domains == []
    assert create(client, email="someone@gmail.com")["email"] == "someone@gmail.com"


def test_other_domains_are_rejected_when_a_list_is_set(
    db: Session, client: TestClient, coordinator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "staff_email_domains", ["unc.edu"])

    response = client.post(URL, json={**NEW_STAFF, "email": "someone@gmail.com"})

    assert response.status_code == 422
    assert response.json()["code"] == "email_domain_not_allowed"
    assert db.scalar(select(func.count()).select_from(Account)) == 1
    # The allowed domain matches in any case.
    assert create(client, email="someone@UNC.edu")["email"] == "someone@unc.edu"


def test_create_writes_one_audit_row(db: Session, client: TestClient, coordinator: Account) -> None:
    created = create(client, role="coordinator")

    [entry] = db.scalars(select(AuditLog))
    assert entry.action == "account.create"
    assert entry.actor_account_id == coordinator.id
    assert entry.target_type == "account"
    assert str(entry.target_id) == created["id"]
    assert entry.details == {"role": "coordinator"}


def test_failed_creates_write_no_audit_rows(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    create(client)
    client.post(URL, json=NEW_STAFF)  # duplicate
    client.post(URL, json={**NEW_STAFF, "email": "bad"})  # invalid

    assert db.scalar(select(func.count()).select_from(AuditLog)) == 1


def test_temporary_password_never_reaches_logs_or_the_audit_row(
    db: Session,
    client: TestClient,
    coordinator: Account,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # The "app" logger is pinned to INFO, so lower it too; otherwise debug logs would slip by.
    with caplog.at_level(logging.DEBUG), caplog.at_level(logging.DEBUG, logger="app"):
        password = create(client)["temporary_password"]

    captured = capsys.readouterr()
    for output in (caplog.text, captured.out, captured.err):
        assert password not in output
    [entry] = db.scalars(select(AuditLog))
    assert password not in str(entry.details)


# --- list -----------------------------------------------------------------------------------


def test_list_is_sorted_by_display_name(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    make_account(db, "zed@unc.edu", display_name="zed")
    make_account(db, "amy@unc.edu", display_name="Amy")
    make_account(db, "bo@unc.edu", display_name="Bo")
    db.commit()

    names = [a["display_name"] for a in client.get(URL).json()]

    assert names == ["Amy", "Bo", "Coordinator", "zed"]


def test_list_never_includes_password_fields(client: TestClient, coordinator: Account) -> None:
    [account] = client.get(URL).json()

    assert not any("password" in key for key in account)


def test_role_and_is_active_filters(db: Session, client: TestClient, coordinator: Account) -> None:
    make_account(db, "active@unc.edu", display_name="Active responder")
    make_account(db, "gone@unc.edu", display_name="Inactive responder", is_active=False)
    make_account(
        db,
        "old@unc.edu",
        display_name="Inactive coordinator",
        role=AccountRole.COORDINATOR,
        is_active=False,
    )
    db.commit()

    def names(params: dict[str, str]) -> list[str]:
        response = client.get(URL, params=params)
        assert response.status_code == 200
        return [a["display_name"] for a in response.json()]

    assert names({"role": "responder"}) == ["Active responder", "Inactive responder"]
    assert names({"role": "coordinator"}) == ["Coordinator", "Inactive coordinator"]
    assert names({"is_active": "false"}) == ["Inactive coordinator", "Inactive responder"]
    assert names({"role": "responder", "is_active": "true"}) == ["Active responder"]
    assert len(names({})) == 4
    assert client.get(URL, params={"role": "admin"}).status_code == 422


def test_on_shift_reflects_an_open_shift(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    now = datetime.now(UTC)
    on = make_account(db, "on@unc.edu", display_name="On shift")
    ended = make_account(db, "ended@unc.edu", display_name="Shift ended")
    make_account(db, "never@unc.edu", display_name="Never on shift")
    db.add(Shift(account_id=on.id, started_at=now, last_heartbeat_at=now))
    db.add(Shift(account_id=ended.id, started_at=now, last_heartbeat_at=now, ended_at=now))
    db.commit()

    on_shift = {a["display_name"]: a["on_shift"] for a in client.get(URL).json()}

    assert on_shift == {
        "Coordinator": False,
        "Never on shift": False,
        "On shift": True,
        "Shift ended": False,
    }


def test_duplicate_that_slips_past_the_check_still_gives_409(
    db: Session, client: TestClient, coordinator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Simulates two coordinators creating the same email at once: the pre-check passes for
    # both, and the database's unique constraint stops the second insert.
    create(client)
    monkeypatch.setattr(accounts_router, "_email_taken", lambda _db, _email: False)

    response = client.post(URL, json={**NEW_STAFF, "email": "NEW.STAFF@unc.edu"})

    assert response.status_code == 409
    assert response.json()["code"] == "email_taken"
    assert db.scalar(select(func.count()).select_from(AuditLog)) == 1
    # The coordinator's session survived the rollback.
    assert client.get(URL).status_code == 200
