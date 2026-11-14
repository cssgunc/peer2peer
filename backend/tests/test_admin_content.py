from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, ContentBlock
from app.services.audit import AuditLog
from app.services.content_blocks import CONTENT_BLOCKS
from app.services.sessions import SESSION_COOKIE_NAME, issue_session


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


def test_get_admin_content_403_for_responders(db: Session, client: TestClient) -> None:
    responder = make_account(db, AccountRole.RESPONDER)
    db.commit()
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, responder, datetime.now(UTC)))

    response = client.get("/api/admin/content")

    assert response.status_code == 403


def test_update_admin_content_403_for_responders(db: Session, client: TestClient) -> None:
    responder = make_account(db, AccountRole.RESPONDER)
    db.commit()
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, responder, datetime.now(UTC)))

    response = client.put(
        "/api/admin/content/home.intro",
        json={"title": "Updated introduction", "body_md": "Welcome to Peer2Peer"},
    )

    assert response.status_code == 403


def test_admin_content_lists_all_blocks_with_defaults(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    response = client.get("/api/admin/content")

    assert response.status_code == 200
    blocks_by_slug = {item["slug"]: item for item in response.json()}
    assert set(blocks_by_slug) == set(CONTENT_BLOCKS)

    for slug, definition in CONTENT_BLOCKS.items():
        assert db.get(ContentBlock, slug) is None
        assert blocks_by_slug[slug] == {
            "slug": slug,
            "title": definition.title,
            "body_md": definition.body_md,
            "updated_at": None,
        }


# Test get content w/ slug
def test_known_slug_returns_content(db: Session, client: TestClient, coordinator: Account) -> None:
    slug = "home.intro"
    response = client.get(f"/api/admin/content/{slug}")

    assert response.status_code == 200

    assert CONTENT_BLOCKS[slug].title == response.json()["title"]
    assert CONTENT_BLOCKS[slug].body_md == response.json()["body_md"]


def test_unknown_slug_returns_404(db: Session, client: TestClient, coordinator: Account) -> None:
    slug = "Unknown slug"
    get_response = client.get(f"/api/admin/content/{slug}")
    assert get_response.status_code == 404

    updated = {"title": "Updated instructions", "body_md": "New content for the home page."}
    put_response = client.put(f"/api/admin/content/{slug}", json=updated)
    assert put_response.status_code == 404


def tests_saving_block_changes_get(db: Session, client: TestClient, coordinator: Account) -> None:
    slug = "home.intro"
    updated = {"title": "Updated instructions", "body_md": "New content for the home page."}

    put_response = client.put(f"/api/admin/content/{slug}", json=updated)
    assert put_response.status_code == 200

    get_response = client.get(f"/api/content/{slug}")
    assert get_response.status_code == 200
    assert get_response.json()["title"] == updated["title"]
    assert get_response.json()["body_md"] == updated["body_md"]

    # Second put w/ slug
    second_update = {
        "title": "second title",
        "body_md": "Revised content",
    }

    second_response = client.put(f"/api/admin/content/{slug}", json=second_update)
    assert second_response.status_code == 200

    get_response = client.get(f"/api/admin/content/{slug}")
    assert get_response.status_code == 200
    assert get_response.json()["title"] == second_update["title"]
    assert get_response.json()["body_md"] == second_update["body_md"]


def test_update_adds_audit_row(db: Session, client: TestClient, coordinator: Account) -> None:
    before = len(db.scalars(select(AuditLog)).all())

    slug = "home.intro"
    updated = {"title": "Updated instructions", "body_md": "New content for the home page."}
    put_response = client.put(f"/api/admin/content/{slug}", json=updated)
    assert put_response.status_code == 200

    after = len(db.scalars(select(AuditLog)).all())
    assert before + 1 == after
