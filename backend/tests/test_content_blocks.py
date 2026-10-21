from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, ContentBlock
from app.services.content_blocks import CONTENT_BLOCKS, get_block


def save_block(db: Session, slug: str) -> ContentBlock:
    editor = Account(
        email="editor@example.com",
        display_name="Coordinator",
        password_hash="unused",
        role=AccountRole.COORDINATOR,
    )
    db.add(editor)
    db.flush()
    block = ContentBlock(
        slug=slug,
        title="Edited title",
        body_md="**Edited Markdown**\n\n<script>plain text</script>",
        updated_by=editor.id,
    )
    db.add(block)
    db.flush()
    return block


@pytest.mark.parametrize("slug", [slug for slug, block in CONTENT_BLOCKS.items() if block.public])
def test_public_defaults(client: TestClient, db: Session, slug: str) -> None:
    response = client.get(f"/api/content/{slug}")

    assert response.status_code == 200
    assert response.json() == {
        "slug": slug,
        "title": CONTENT_BLOCKS[slug].title,
        "body_md": CONTENT_BLOCKS[slug].body_md,
        "updated_at": None,
    }
    assert "Placeholder:" in response.json()["body_md"]
    assert db.get(ContentBlock, slug) is None


def test_stored_block_wins(client: TestClient, db: Session) -> None:
    block = save_block(db, "home.how-it-works")

    response = client.get("/api/content/home.how-it-works")

    assert response.status_code == 200
    result = response.json()
    assert result == {
        "slug": block.slug,
        "title": block.title,
        "body_md": block.body_md,
        "updated_at": result["updated_at"],
    }
    assert datetime.fromisoformat(result["updated_at"]) == block.updated_at


@pytest.mark.parametrize("slug", ["unknown.slug", "portal.guide"])
@pytest.mark.parametrize("stored", [False, True])
def test_unavailable_blocks_return_not_found(
    client: TestClient, db: Session, slug: str, stored: bool
) -> None:
    if stored:
        save_block(db, slug)

    response = client.get(f"/api/content/{slug}")

    assert response.status_code == 404
    assert response.json() == {"code": "not_found", "detail": "Content block not found"}


def test_internal_guide_available_to_service(db: Session) -> None:
    default = get_block(db, "portal.guide")
    assert default.updated_at is None
    assert default.body_md == CONTENT_BLOCKS["portal.guide"].body_md

    block = save_block(db, "portal.guide")
    assert get_block(db, "portal.guide").body_md == block.body_md


def test_unknown_slug_has_no_service_default(db: Session) -> None:
    with pytest.raises(KeyError):
        get_block(db, "unknown.slug")


def test_after_hours_preserves_next_open_placeholder() -> None:
    assert "{next_open}" in CONTENT_BLOCKS["chat.after-hours"].body_md
