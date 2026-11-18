from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, AuditLog
from app.services.sessions import SESSION_COOKIE_NAME, issue_session
from app.services.site_settings import SETTINGS


def make_account(db: Session, role: AccountRole) -> Account:
    account = Account(
        email="admin_settings_test@unc.edu",
        display_name="Test admin setting",
        password_hash="placeholder-not-real-password",
        role=role,
        must_change_password=False,
    )
    db.add(account)
    db.flush()
    return account


@pytest.fixture
def coordinator(db: Session, client: TestClient) -> Account:
    account = make_account(db, role=AccountRole.COORDINATOR)
    token = issue_session(db, account, datetime.now(UTC))
    client.cookies.set(SESSION_COOKIE_NAME, token)
    db.commit()
    return account


def test_get_admin_settings_returns_403_for_responder(db: Session, client: TestClient) -> None:
    responder_account = make_account(db, role=AccountRole.RESPONDER)
    db.commit()
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, responder_account, datetime.now(UTC)))

    response = client.get("/api/admin/settings")

    assert response.status_code == 403


def test_update_settings_returns_403_for_responder(db: Session, client: TestClient) -> None:
    responder_account = make_account(db, role=AccountRole.RESPONDER)
    db.commit()
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, responder_account, datetime.now(UTC)))

    response = client.put("/api/admin/settings/tagline", json={"value": "Updated tagline"})

    assert response.status_code == 403


def test_non_public_keys_appear_for_coordinators(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    response = client.get("/api/admin/settings")
    assert response.status_code == 200

    settings_by_key = {item["key"]: item for item in response.json()}

    non_public_keys = {key for key, definition in SETTINGS.items() if not definition.public}

    assert non_public_keys <= settings_by_key.keys()
    for key in non_public_keys:
        assert settings_by_key[key]["public"] is False

    assert set(settings_by_key) == set(SETTINGS)

    for key, definition in SETTINGS.items():
        assert settings_by_key[key]["description"] == definition.description
        assert settings_by_key[key]["public"] is definition.public


def tests_unknown_key_404(db: Session, client: TestClient, coordinator: Account) -> None:
    response = client.put("/api/admin/settings/not-a-setting", json={"value": "bad key"})
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("key", "bad_value"),
    [
        ("contact_email", "not-an-email"),
        ("responder_form_url", "not a URL"),
        ("line_launch_at", "2026-11-13T12:00:00"),  # no timezone
        ("after_hours_behavior", "sometimes"),
    ],
)
def test_bad_values_rejected(
    db: Session, client: TestClient, coordinator: Account, key: str, bad_value: object
) -> None:
    response = client.put(f"/api/admin/settings/{key}", json={"value": bad_value})

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("key", "good_value"),
    [
        ("contact_email", "admin-settings-test@unc.edu"),
        ("responder_form_url", "https://test-link.com"),
        ("line_launch_at", "2026-11-13T12:00:00Z"),
        ("after_hours_behavior", "close"),
    ],
)
def test_valid_values_accepted(
    db: Session, client: TestClient, coordinator: Account, key: str, good_value: object
) -> None:
    before = len(db.scalars(select(AuditLog)).all())

    response = client.put(f"/api/admin/settings/{key}", json={"value": good_value})
    assert response.status_code == 200

    after = len(db.scalars(select(AuditLog)).all())
    assert after == before + 1
