import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import seed
from app.cli import main
from app.config import get_settings
from app.models import Account, AccountRole, AuthSession


def make_account(email: str = "staff@unc.edu") -> Account:
    return Account(
        email=email,
        display_name="Test staff",
        password_hash="placeholder-not-a-real-password-hash",
        role=AccountRole.RESPONDER,
    )


def test_account_and_session_ids_are_uuid7(db: Session) -> None:
    account = make_account()
    db.add(account)
    db.flush()
    now = datetime.now(UTC)
    session = AuthSession(
        account_id=account.id,
        token_hash=hashlib.sha256(b"test-token").digest(),
        last_seen_at=now,
        expires_at=now + timedelta(hours=1),
    )
    db.add(session)
    db.flush()

    assert account.id.version == session.id.version == 7
    assert account.created_at.utcoffset() == timedelta(0)
    assert account.is_active is True
    assert account.must_change_password is True
    assert db.scalar(
        text("SELECT role::text FROM accounts WHERE id = :id"), {"id": account.id}
    ) == ("responder")


def test_email_is_unique_without_regard_to_case(db: Session) -> None:
    db.add(make_account("A@unc.edu"))
    db.flush()
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(make_account("a@unc.edu"))
        db.flush()


def test_updated_at_changes_within_one_transaction(db: Session) -> None:
    account = make_account()
    db.add(account)
    db.flush()
    created_at, updated_at = account.created_at, account.updated_at
    account.display_name = "Updated staff name"
    db.flush()
    db.refresh(account)

    assert account.updated_at > updated_at
    assert account.created_at == created_at


def test_token_hash_is_unique(db: Session) -> None:
    account = make_account()
    db.add(account)
    db.flush()
    now = datetime.now(UTC)
    values = dict(
        account_id=account.id,
        token_hash=hashlib.sha256(b"test-token").digest(),
        last_seen_at=now,
        expires_at=now + timedelta(hours=1),
    )
    db.add(AuthSession(**values))
    db.flush()
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(AuthSession(**values))
        db.flush()


def test_seed_dev_runs_twice(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "environment", "development")
    main(["seed-dev"])
    main(["seed-dev"])


@pytest.mark.parametrize("environment", ["test", "production"])
def test_seed_dev_refuses_other_environments(
    environment: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(get_settings(), "environment", environment)
    called = []
    monkeypatch.setattr(seed, "registry", [lambda session: called.append(True)])
    with pytest.raises(SystemExit) as error:
        main(["seed-dev"])
    assert error.value.code == 1
    assert "only allowed in the development environment" in capsys.readouterr().err
    assert not called
