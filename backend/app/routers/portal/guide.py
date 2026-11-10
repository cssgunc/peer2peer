from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_staff
from app.schemas.content import ContentBlockDTO
from app.services.content_blocks import get_block

router = APIRouter(prefix="/portal", tags=["portal"], dependencies=[Depends(require_staff)])


@router.get("/guide", response_model=ContentBlockDTO)
def read_guide(db: Annotated[Session, Depends(get_db)]) -> ContentBlockDTO:
    return get_block(db, "portal.guide")
