from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.resources import ResourceDTO, ResourceTagDTO
from app.services.resources import list_resources, list_tags

router = APIRouter(tags=["resources"])


@router.get("/resources", response_model=list[ResourceDTO])
def read_resources(
    db: Annotated[Session, Depends(get_db)], tag: str | None = None, unc: bool | None = None
) -> list[ResourceDTO]:
    return list_resources(db, tag=tag, unc=unc)


@router.get("/resource-tags", response_model=list[ResourceTagDTO])
def read_resource_tags(db: Annotated[Session, Depends(get_db)]) -> list[ResourceTagDTO]:
    return list_tags(db)
