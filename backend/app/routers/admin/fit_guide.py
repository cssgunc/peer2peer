import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account
from app.models.fit_guide import FitGuideItem
from app.models.resource import Resource
from app.schemas.fit_guide import (
    AdminFitGuideItemDTO,
    FitGuideItemInputDTO,
    FitGuideItemPatchDTO,
)
from app.services.audit import AuditAction, record_audit

router = APIRouter(prefix="/admin/fit-guide", tags=["admin fit guide"])
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


def get_item(db: Session, id: uuid.UUID) -> FitGuideItem:
    item = db.get(FitGuideItem, id)
    if item is None:
        raise HTTPException(status_code=404, detail="Fit guide item not found")
    return item


def validate_resource(db: Session, resource_id: uuid.UUID | None) -> None:
    if resource_id is not None and db.get(Resource, resource_id) is None:
        raise HTTPException(status_code=422, detail="resource_id: Resource not found")


@router.get("", response_model=list[AdminFitGuideItemDTO])
def list_items(db: Database, actor: Coordinator):
    return db.scalars(
        select(FitGuideItem).order_by(FitGuideItem.display_order, FitGuideItem.id)
    ).all()


@router.post("", response_model=AdminFitGuideItemDTO, status_code=201)
def create_item(data: FitGuideItemInputDTO, db: Database, actor: Coordinator):
    validate_resource(db, data.resource_id)
    item = FitGuideItem(**data.model_dump())
    db.add(item)
    db.flush()
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.FIT_GUIDE_CREATE,
        target_type="fit_guide",
        target_id=item.id,
    )
    db.commit()
    return item


@router.patch("/{id}", response_model=AdminFitGuideItemDTO)
def update_item(id: uuid.UUID, data: FitGuideItemPatchDTO, db: Database, actor: Coordinator):
    item = get_item(db, id)
    values = data.model_dump(exclude_unset=True)
    if "resource_id" in values:
        validate_resource(db, data.resource_id)
    for field, value in values.items():
        setattr(item, field, value)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.FIT_GUIDE_UPDATE,
        target_type="fit_guide",
        target_id=item.id,
        details={"fields": sorted(values)},
    )
    db.commit()
    return item


@router.delete("/{id}", status_code=204)
def delete_item(id: uuid.UUID, db: Database, actor: Coordinator) -> Response:
    item = get_item(db, id)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.FIT_GUIDE_DELETE,
        target_type="fit_guide",
        target_id=item.id,
    )
    db.delete(item)
    db.commit()
    return Response(status_code=204)
