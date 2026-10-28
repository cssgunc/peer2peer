from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.fit_guide import Fit, FitGuideItem
from app.models.resource import Resource
from app.schemas.fit_guide import FitGuideDTO, FitGuideItemDTO, FitGuideResourceDTO

router = APIRouter(prefix="/fit-guide", tags=["fit guide"])


@router.get("", response_model=FitGuideDTO)
def get_fit_guide(db: Annotated[Session, Depends(get_db)]) -> FitGuideDTO:
    query = (
        select(FitGuideItem, Resource)
        .outerjoin(
            Resource,
            (FitGuideItem.resource_id == Resource.id) & Resource.is_published.is_(True),
        )
        .order_by(FitGuideItem.display_order, FitGuideItem.id)
    )
    lists: dict[Fit, list[FitGuideItemDTO]] = {fit: [] for fit in Fit}
    for item, resource in db.execute(query):
        lists[item.fit].append(
            FitGuideItemDTO(
                id=item.id,
                text=item.text,
                resource_id=item.resource_id,
                resource=FitGuideResourceDTO.model_validate(resource) if resource else None,
            )
        )
    return FitGuideDTO(good_fit=lists[Fit.GOOD_FIT], other_resource=lists[Fit.OTHER_RESOURCE])
