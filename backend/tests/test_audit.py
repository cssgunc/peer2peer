import uuid
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, AuditLog
from app.services.audit import AuditAction, record_audit


def test_entry_fields(db: Session) -> None:
    account = Account(
        email="audit@unc.edu",
        display_name="Coordinator",
        password_hash="test-only",
        role=AccountRole.COORDINATOR,
    )
    db.add(account)
    db.flush()
    target_id = uuid.uuid7()
    details: dict[str, Any] = {"fields": ["role"], "description": "Changed staff role"}
    entry = record_audit(
        db,
        actor_id=account.id,
        action=AuditAction.ACCOUNT_UPDATE,
        target_type="account",
        target_id=target_id,
        details=details,
    )
    details["fields"].append("is_active")
    db.flush()
    db.expire_all()
    saved = db.scalar(select(AuditLog).where(AuditLog.id == entry.id))
    assert saved is not None
    assert isinstance(saved.id, int)
    assert saved.actor_account_id == account.id
    assert saved.action == "account.update"
    assert saved.target_type == "account"
    assert saved.target_id == target_id
    assert saved.details == {"fields": ["role"], "description": "Changed staff role"}
    assert saved.created_at.utcoffset() == timedelta(0)


def test_does_not_commit(db: Session) -> None:
    entry = record_audit(
        db,
        actor_id=None,
        action=AuditAction.SETTINGS_UPDATE,
        target_type="settings",
    )
    db.flush()
    entry_id = entry.id
    db.rollback()
    assert db.get(AuditLog, entry_id) is None


def test_system_action_and_optional_defaults(db: Session) -> None:
    entry = record_audit(
        db,
        actor_id=None,
        action=AuditAction.CONTENT_UPDATE,
        target_type="content",
    )
    db.flush()
    db.refresh(entry)
    assert entry.actor_account_id is None
    assert entry.target_id is None
    assert entry.details == {}


@pytest.mark.parametrize(
    "key",
    [
        "body",
        "message",
        "phone",
        "ip",
        "identity_hash",
        "password",
        "token",
        "BODY",
        "phone_number",
        "ip_address",
        "accessToken",
        "identityHash",
        "body_ciphertext",
    ],
)
@pytest.mark.parametrize("nested", [False, True])
def test_sensitive_keys_rejected(db: Session, key: str, nested: bool) -> None:
    details: dict[str, Any] = {key: "sensitive-test-value"}
    if nested:
        details = {"changes": [{"previous": details}]}
    with pytest.raises(ValueError, match="potentially sensitive key") as error:
        record_audit(
            db,
            actor_id=None,
            action=AuditAction.ACCOUNT_UPDATE,
            target_type="account",
            details=details,
        )
    assert "sensitive-test-value" not in str(error.value)
    assert not db.new
