from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account
from app.models.faq import Faq
from app.models.fit_guide import FitGuideItem
from app.models.report import ReportOption
from app.models.resource import Resource, ResourceTag
from app.models.statistic import Statistic
from app.schemas.faqs import AdminFaqDTO
from app.schemas.fit_guide import AdminFitGuideItemDTO
from app.schemas.reorder import ReorderDTO
from app.schemas.report import AdminReportOptionDTO
from app.schemas.resources import AdminResourceDTO, AdminResourceTagDTO
from app.schemas.statistics import AdminStatisticDTO
from app.services.audit import AuditAction, record_audit

router = APIRouter(prefix="/admin", tags=["admin reorder"])
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


@dataclass(frozen=True)
class Collection:
    model: Any
    dto: type[BaseModel]
    action: AuditAction
    target_type: str
    options: tuple[Any, ...] = ()


COLLECTIONS = {
    "faqs": Collection(Faq, AdminFaqDTO, AuditAction.FAQ_REORDER, "faq"),
    "statistics": Collection(
        Statistic, AdminStatisticDTO, AuditAction.STATISTIC_REORDER, "statistic"
    ),
    "fit-guide": Collection(
        FitGuideItem, AdminFitGuideItemDTO, AuditAction.FIT_GUIDE_REORDER, "fit_guide"
    ),
    "resources": Collection(
        Resource,
        AdminResourceDTO,
        AuditAction.RESOURCE_REORDER,
        "resource",
        (selectinload(Resource.tags),),
    ),
    "resource-tags": Collection(
        ResourceTag, AdminResourceTagDTO, AuditAction.RESOURCE_TAG_REORDER, "resource_tag"
    ),
    "report-options": Collection(
        ReportOption, AdminReportOptionDTO, AuditAction.REPORT_OPTION_REORDER, "report_option"
    ),
}


@router.put("/{collection}/reorder")
def reorder(collection: str, data: ReorderDTO, db: Database, actor: Coordinator) -> list[Any]:
    config = COLLECTIONS.get(collection)
    if config is None:
        raise HTTPException(404, "Collection not found")
    model = config.model
    rows: list[Any] = list(
        db.scalars(select(model).where(model.id.in_(data.ids)).options(*config.options))
    )
    by_id = {row.id: row for row in rows}
    if len(by_id) != len(data.ids):
        raise HTTPException(422, f"ids: Not every id belongs to {collection}")

    # Reuse the positions these items already hold so items outside the list stay put.
    # Bump ties so the new order is strict even when items shared a position.
    slots: list[int] = []
    for position in sorted(row.display_order for row in rows):
        slots.append(position if not slots else max(position, slots[-1] + 1))
    items = [by_id[id] for id in data.ids]
    for item, slot in zip(items, slots, strict=True):
        item.display_order = slot

    record_audit(
        db,
        actor_id=actor.id,
        action=config.action,
        target_type=config.target_type,
        details={"count": len(items)},
    )
    db.commit()
    return [config.dto.model_validate(item, from_attributes=True) for item in items]
