from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, ContentBlock
from app.services.content_blocks import CONTENT_BLOCKS
from app.services.sessions import SESSION_COOKIE_NAME, issue_session

URL = "/api/portal/guide"
SLUG = "portal.guide"


@pytest.fixture(params=list(AccountRole))
def staff(db: Session, request: pytest.FixtureRequest) -> Account:
    account = Account(
        email="guide-staff@unc.edu",
        display_name="Guide staff",
        password_hash="unused",
        role=request.param,
    )
    db.add(account)
    db.flush()
    return account


@pytest.mark.parametrize("token", [None, "invalid-session"])
def test_guide_requires_session(client: TestClient, token: str | None) -> None:
    if token is not None:
        client.cookies.set(SESSION_COOKIE_NAME, token)

    response = client.get(URL)

    assert response.status_code == 401
    assert response.json()["code"] == "not_authenticated"


def test_guide_rejects_expired_session(client: TestClient, db: Session, staff: Account) -> None:
    token = issue_session(db, staff, datetime.now(UTC) - timedelta(days=1))
    db.commit()
    client.cookies.set(SESSION_COOKIE_NAME, token)

    assert client.get(URL).status_code == 401


def test_staff_can_read_default_guide_without_a_shift(
    client: TestClient, db: Session, staff: Account
) -> None:
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, staff, datetime.now(UTC)))
    db.commit()

    response = client.get(URL)

    assert response.status_code == 200
    assert response.json() == {
        "slug": SLUG,
        "title": CONTENT_BLOCKS[SLUG].title,
        "body_md": CONTENT_BLOCKS[SLUG].body_md,
        "updated_at": None,
    }
    assert db.get(ContentBlock, SLUG) is None


def test_staff_receive_stored_guide(client: TestClient, db: Session, staff: Account) -> None:
    block = ContentBlock(
        slug=SLUG,
        title="Updated responder guide",
        body_md="## Resource guide\n\n**Edited guide content**",
        updated_by=staff.id,
    )
    db.add(block)
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, staff, datetime.now(UTC)))
    db.commit()

    response = client.get(URL)

    assert response.status_code == 200
    result = response.json()
    assert result == {
        "slug": block.slug,
        "title": block.title,
        "body_md": block.body_md,
        "updated_at": result["updated_at"],
    }
    assert datetime.fromisoformat(result["updated_at"]) == block.updated_at

    # Even a signed-in staff member cannot expose the guide through the public API.
    assert client.get(f"/api/content/{SLUG}").status_code == 404
    client.cookies.clear()
    assert client.get(URL).status_code == 401
