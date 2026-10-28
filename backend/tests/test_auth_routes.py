import hashlib
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app import cli, database, seed
from app.config import get_settings
from app.database import get_db
from app.main import app
from app.models import Account, AccountRole, AuthSession
from app.models.shift import Shift, ShiftEndReason
from app.routers import auth
from app.security import rate_limit as rate_limit_module
from app.security.passwords import hash_password, password_problems, verify_password
from app.services.sessions import SESSION_COOKIE_NAME, issue_session
from app.services.shifts import start_shift

PASSWORD = "A distinct! password 2026"


@pytest.fixture(scope="module")
def password_hash() -> str:
    return hash_password(PASSWORD)


@pytest.fixture
def account(db: Session, password_hash: str) -> Account:
    account = Account(
        email="staff@unc.edu",
        display_name="Test staff",
        password_hash=password_hash,
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.commit()
    return account


@pytest.fixture
def auth_client(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(get_settings(), "session_cookie_secure", True)

    def override_db() -> Iterator[Session]:
        try:
            yield db
        finally:
            # Model get_db closing a real session, so missing commits cannot pass tests.
            db.rollback()

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app, base_url="https://testserver") as client:
            yield client
    finally:
        app.dependency_overrides.clear()


def sign_in(client: TestClient, email: str = "staff@unc.edu", password: str = PASSWORD):
    return client.post("/api/auth/sign-in", json={"email": email, "password": password})


def test_sign_in_sets_cookie_and_me_works(
    db: Session, auth_client: TestClient, account: Account
) -> None:
    before = datetime.now(UTC)
    response = sign_in(auth_client, " STAFF@unc.edu ")
    assert response.status_code == 200
    expected = {
        "id": str(account.id),
        "email": account.email,
        "display_name": account.display_name,
        "role": "responder",
        "must_change_password": True,
        "shift": None,
    }
    assert response.json() == expected
    assert auth_client.get("/api/auth/me").json() == expected
    header = response.headers["set-cookie"]
    for attribute in ("HttpOnly", "SameSite=strict", "Secure", "Path=/"):
        assert attribute in header
    assert f"Max-Age={get_settings().session_max_hours * 3600}" in header
    db.expire_all()
    assert account.last_login_at is not None
    assert before <= account.last_login_at <= datetime.now(UTC)
    session = db.scalars(select(AuthSession)).one()
    token = auth_client.cookies[SESSION_COOKIE_NAME]
    assert session.token_hash == hashlib.sha256(token.encode()).digest()
    assert session.last_seen_at == account.last_login_at
    assert db.scalar(select(func.count()).select_from(Shift)) == 0


def test_sign_in_and_me_include_only_the_open_shift(
    db: Session, auth_client: TestClient, account: Account
) -> None:
    shift = start_shift(db, account, datetime.now(UTC))
    db.commit()
    expected = {
        "id": str(shift.id),
        "started_at": shift.started_at.isoformat().replace("+00:00", "Z"),
    }
    assert sign_in(auth_client).json()["shift"] == expected
    assert auth_client.get("/api/auth/me").json()["shift"] == expected


def test_development_http_cookie(
    auth_client: TestClient, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "session_cookie_secure", False)
    auth_client.base_url = "http://testserver"
    response = sign_in(auth_client)
    assert response.status_code == 200
    assert "Secure" not in response.headers["set-cookie"]
    assert auth_client.get("/api/auth/me").status_code == 200


def test_failed_sign_in_commit_does_not_persist_login_or_session(
    db: Session, auth_client: TestClient, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_commit() -> None:
        raise RuntimeError("Simulated commit failure")

    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="Simulated commit failure"):
        sign_in(auth_client)
    db.expire_all()
    assert account.last_login_at is None
    assert db.scalar(select(func.count()).select_from(AuthSession)) == 0
    assert SESSION_COOKIE_NAME not in auth_client.cookies


def test_credential_failures_are_identical_and_do_not_create_sessions(
    db: Session, auth_client: TestClient, account: Account
) -> None:
    responses = [sign_in(auth_client, password="wrong"), sign_in(auth_client, "unknown@unc.edu")]
    account.is_active = False
    db.commit()
    responses.append(sign_in(auth_client))
    for response in responses:
        assert response.status_code == 401
        assert response.json() == {
            "code": "invalid_credentials",
            "detail": "Invalid email or password.",
        }
        assert "set-cookie" not in response.headers
    db.expire_all()
    assert account.last_login_at is None
    assert db.scalar(select(func.count()).select_from(AuthSession)) == 0


def test_unknown_and_inactive_accounts_still_verify_passwords(
    db: Session, auth_client: TestClient, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = []

    def verify(password: str, hashed: str) -> bool:
        calls.append((password, hashed))
        return verify_password(password, hashed)

    monkeypatch.setattr(auth, "verify_password", verify)
    assert sign_in(auth_client, "unknown@unc.edu").status_code == 401
    assert calls == [(PASSWORD, auth._DUMMY_HASH)]
    assert auth._DUMMY_HASH.startswith("$argon2id$")
    account.is_active = False
    db.commit()
    assert sign_in(auth_client).status_code == 401
    assert calls[-1] == (PASSWORD, account.password_hash)


def test_email_limit_normalizes_email_and_recovers(
    auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000.0]
    monkeypatch.setattr(rate_limit_module.time, "monotonic", lambda: clock[0])
    for email in ["a@unc.edu", " A@unc.edu ", "A@unc.edu", "a@unc.edu", "a@unc.edu"]:
        assert sign_in(auth_client, email).status_code == 401
    response = sign_in(auth_client, " A@unc.edu ")
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert response.headers["Retry-After"] == "900"
    clock[0] += 900
    assert sign_in(auth_client, "a@unc.edu").status_code == 401


def test_successful_sign_ins_count_toward_email_limit(
    auth_client: TestClient, account: Account
) -> None:
    for _ in range(5):
        assert sign_in(auth_client).status_code == 200
    assert sign_in(auth_client).status_code == 429


def test_ip_limit_across_emails_and_recovery(
    auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000.0]
    monkeypatch.setattr(rate_limit_module.time, "monotonic", lambda: clock[0])
    for index in range(20):
        assert sign_in(auth_client, f"staff{index}@unc.edu").status_code == 401
    response = sign_in(auth_client, "another@unc.edu")
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "900"
    clock[0] += 900
    assert sign_in(auth_client, "another@unc.edu").status_code == 401


@pytest.mark.parametrize("with_shift", [False, True])
def test_sign_out_revokes_cookie_and_ends_shift(
    db: Session, auth_client: TestClient, account: Account, with_shift: bool
) -> None:
    shift = start_shift(db, account, datetime.now(UTC)) if with_shift else None
    db.commit()
    assert sign_in(auth_client).status_code == 200
    token = auth_client.cookies[SESSION_COOKIE_NAME]
    response = auth_client.post("/api/auth/sign-out")
    assert response.status_code == 204
    assert response.content == b""
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert SESSION_COOKIE_NAME not in auth_client.cookies
    db.expire_all()
    session = db.scalars(select(AuthSession)).one()
    assert session.revoked_at is not None
    if shift is not None:
        assert shift.ended_at == session.revoked_at
        assert shift.ended_reason == ShiftEndReason.SIGNED_OUT
    # Replaying the old token must fail, independently of the browser clearing its cookie.
    auth_client.cookies.set(SESSION_COOKIE_NAME, token)
    assert auth_client.get("/api/auth/me").status_code == 401


def test_sign_out_rolls_back_revocation_and_shift_together(
    db: Session, auth_client: TestClient, account: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    shift = start_shift(db, account, datetime.now(UTC))
    db.commit()
    assert sign_in(auth_client).status_code == 200
    commit = db.commit
    calls = 0

    def fail_handler_commit() -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Simulated commit failure")
        commit()

    monkeypatch.setattr(db, "commit", fail_handler_commit)
    with pytest.raises(RuntimeError, match="Simulated commit failure"):
        auth_client.post("/api/auth/sign-out")
    assert calls == 2  # The authentication dependency commits activity before the handler runs.
    db.expire_all()
    assert db.scalars(select(AuthSession)).one().revoked_at is None
    assert shift.ended_at is None
    assert shift.ended_reason is None


@pytest.mark.parametrize("state", ["missing", "unknown", "expired", "idle", "revoked", "inactive"])
def test_me_and_sign_out_reject_invalid_authentication(
    db: Session, auth_client: TestClient, account: Account, state: str
) -> None:
    if state == "unknown":
        auth_client.cookies.set(SESSION_COOKIE_NAME, "unknown-token")
    elif state != "missing":
        token = issue_session(db, account, datetime.now(UTC))
        session = db.scalars(select(AuthSession)).one()
        if state == "expired":
            session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        elif state == "idle":
            session.last_seen_at -= timedelta(minutes=get_settings().session_idle_minutes)
        elif state == "revoked":
            session.revoked_at = datetime.now(UTC)
        else:
            account.is_active = False
        db.commit()
        auth_client.cookies.set(SESSION_COOKIE_NAME, token)
    for method, path in [("GET", "/api/auth/me"), ("POST", "/api/auth/sign-out")]:
        response = auth_client.request(method, path)
        assert response.status_code == 401
        assert response.json()["code"] == "not_authenticated"


def test_failed_sign_in_does_not_log_credentials(
    auth_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    assert sign_in(auth_client, "private@unc.edu", "private password").status_code == 401
    assert "private@unc.edu" not in caplog.text
    assert "private password" not in caplog.text


@pytest.fixture
def cli_db(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        database,
        "SessionLocal",
        sessionmaker(bind=db.get_bind(), join_transaction_mode="create_savepoint"),
    )


def test_cli_account_can_sign_in(
    db: Session, cli_db: None, auth_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "getpass", lambda prompt: PASSWORD)
    cli.main(
        [
            "create-account",
            "--email",
            " NEW@unc.edu ",
            "--name",
            "New staff",
            "--role",
            "coordinator",
        ]
    )
    response = sign_in(auth_client, "new@unc.edu")
    assert response.status_code == 200
    assert response.json()["role"] == "coordinator"
    assert response.json()["must_change_password"] is False
    account = db.scalars(select(Account)).one()
    assert account.email == "new@unc.edu"
    assert account.is_active
    assert verify_password(PASSWORD, account.password_hash)


@pytest.mark.parametrize(
    ("email", "name", "role", "password"),
    [
        ("invalid", "Staff", "coordinator", PASSWORD),
        ("staff@unc.edu", " ", "coordinator", PASSWORD),
        ("staff@unc.edu", "x" * 101, "coordinator", PASSWORD),
        ("staff@unc.edu", "Staff", "admin", PASSWORD),
        ("staff@unc.edu", "Staff", "coordinator", "short"),
        ("staff@unc.edu", "Staff", "coordinator", "staff password!2026"),
    ],
)
def test_cli_rejects_invalid_input(
    db: Session,
    cli_db: None,
    monkeypatch: pytest.MonkeyPatch,
    email: str,
    name: str,
    role: str,
    password: str,
) -> None:
    monkeypatch.setattr(cli, "getpass", lambda prompt: password)
    with pytest.raises(SystemExit) as error:
        cli.main(["create-account", "--email", email, "--name", name, "--role", role])
    assert error.value.code != 0
    assert db.scalar(select(func.count()).select_from(Account)) == 0


def test_cli_duplicate_email_has_clear_error(
    db: Session,
    cli_db: None,
    account: Account,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(cli, "getpass", lambda prompt: PASSWORD)
    with pytest.raises(SystemExit) as error:
        cli.main(
            ["create-account", "--email", "STAFF@unc.edu", "--name", "New", "--role", "responder"]
        )
    assert error.value.code == 1
    assert "already exists" in capsys.readouterr().err
    assert db.scalar(select(func.count()).select_from(Account)) == 1


def test_dev_accounts_are_idempotent_and_preserve_existing_accounts(
    db: Session, cli_db: None, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(get_settings(), "environment", "development")
    monkeypatch.setattr(seed, "registry", [seed.seed_accounts])
    cli.main(["seed-dev"])
    output = capsys.readouterr().out
    for role in AccountRole:
        account = db.scalar(select(Account).where(Account.email == f"{role.value}@example.com"))
        assert account is not None
        assert account.role == role
        assert not account.must_change_password
        assert not password_problems(seed.DEV_PASSWORD, account.email)
        assert verify_password(seed.DEV_PASSWORD, account.password_hash)
        assert account.email in output
    assert seed.DEV_PASSWORD in output
    assert account is not None
    account.is_active = False
    account.password_hash = hash_password(PASSWORD)
    db.commit()
    cli.main(["seed-dev"])
    assert capsys.readouterr().out == ""
    db.expire_all()
    assert not account.is_active
    assert verify_password(PASSWORD, account.password_hash)
    assert db.scalar(select(func.count()).select_from(Account)) == 2
