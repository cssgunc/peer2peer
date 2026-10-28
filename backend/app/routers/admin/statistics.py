import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account
from app.models.statistic import Statistic
from app.schemas.statistics import AdminStatisticDTO, StatisticInputDTO, StatisticPatchDTO
from app.services.audit import AuditAction, record_audit

router = APIRouter(prefix="/admin/statistics", tags=["admin statistics"])
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


def get_item(db: Session, id: uuid.UUID) -> Statistic:
    item = db.get(Statistic, id)
    if item is None:
        raise HTTPException(status_code=404, detail="Statistic not found")
    return item


@router.get("", response_model=list[AdminStatisticDTO])
def list_statistics(db: Database, actor: Coordinator):
    return db.scalars(select(Statistic).order_by(Statistic.display_order, Statistic.id)).all()


@router.post("", response_model=AdminStatisticDTO, status_code=201)
def create_statistic(data: StatisticInputDTO, db: Database, actor: Coordinator):
    values = data.model_dump()
    if values["display_order"] is None:
        last = db.scalar(select(func.max(Statistic.display_order)))
        values["display_order"] = 0 if last is None else last + 1
    item = Statistic(**values)
    db.add(item)
    db.flush()
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.STATISTIC_CREATE,
        target_type="statistic",
        target_id=item.id,
    )
    db.commit()
    return item


@router.patch("/{id}", response_model=AdminStatisticDTO)
def update_statistic(id: uuid.UUID, data: StatisticPatchDTO, db: Database, actor: Coordinator):
    item = get_item(db, id)
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(item, field, value)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.STATISTIC_UPDATE,
        target_type="statistic",
        target_id=item.id,
        details={"fields": sorted(values)},
    )
    db.commit()
    return item


@router.delete("/{id}", status_code=204)
def delete_statistic(id: uuid.UUID, db: Database, actor: Coordinator) -> Response:
    item = get_item(db, id)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.STATISTIC_DELETE,
        target_type="statistic",
        target_id=item.id,
    )
    db.delete(item)
    db.commit()
    return Response(status_code=204)
