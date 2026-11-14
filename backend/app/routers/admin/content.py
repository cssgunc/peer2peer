from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account, ContentBlock
from app.schemas.content import ContentBlockDTO, UpdateContentBlockDTO
from app.services.audit import AuditAction, record_audit
from app.services.content_blocks import CONTENT_BLOCKS, get_block

router = APIRouter(prefix="/admin/content", tags=["admin content"])
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


@router.get("", response_model=list[ContentBlockDTO])
def get_content(db: Database, actor: Coordinator) -> list[ContentBlockDTO]:
    content = [get_block(db, slug) for slug in CONTENT_BLOCKS]
    return content


@router.get("/{slug}", response_model=ContentBlockDTO)
def get_content_block(db: Database, actor: Coordinator, slug: str) -> ContentBlockDTO:
    if slug not in CONTENT_BLOCKS:
        raise HTTPException(404, "Unknown slug")
    return get_block(db, slug)


@router.put("/{slug}", response_model=ContentBlockDTO)
def update_content_block(
    db: Database, actor: Coordinator, slug: str, new_content: UpdateContentBlockDTO
) -> ContentBlockDTO:
    if slug not in CONTENT_BLOCKS:
        raise HTTPException(404, "Unknown slug")

    row = db.get(ContentBlock, slug)

    if row is None:
        row = ContentBlock(
            slug=slug,
            title=new_content.title,
            body_md=new_content.body_md,
            updated_by=actor.id,
        )
        db.add(row)
    else:
        row.title = new_content.title
        row.body_md = new_content.body_md
        row.updated_by = actor.id
    db.flush()

    record_audit(
        db=db,
        actor_id=actor.id,
        action=AuditAction.CONTENT_UPDATE,
        target_type="content",
        details={"slug": slug},
    )
    db.commit()

    return ContentBlockDTO(
        slug=slug,
        title=new_content.title,
        body_md=new_content.body_md,
        updated_at=row.updated_at,
    )
