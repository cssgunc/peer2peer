from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.content import ContentBlockDTO
from app.services.content_blocks import CONTENT_BLOCKS, get_block

router = APIRouter(prefix="/content", tags=["content"])


@router.get("/{slug}", response_model=ContentBlockDTO)
def read_content(slug: str, db: Annotated[Session, Depends(get_db)]) -> ContentBlockDTO:
    definition = CONTENT_BLOCKS.get(slug)
    if definition is None or not definition.public:
        raise HTTPException(status_code=404, detail="Content block not found")
    return get_block(db, slug)
