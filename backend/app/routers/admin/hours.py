from datetime import datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.errors import AppError
from app.models import Account
from app.models.hours import HoursException, WeeklyHours
from app.schemas.hours import (
    AdminHoursExceptionDTO,
    HoursDTO,
    HoursExceptionDTO,
    HoursExceptionInputDTO,
    UpdateHoursDTO,
    WeeklyWindowDTO,
)
from app.services.audit import AuditAction, record_audit

router = APIRouter(
    prefix="/admin/hours", tags=["admin"], dependencies=[Depends(require_coordinator)]
)
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


@router.get("", response_model=HoursDTO)
def read_hours(db: Database) -> HoursDTO:
    timezone = get_settings().line_timezone
    today = datetime.now(ZoneInfo(timezone)).date()
    weekly = db.scalars(select(WeeklyHours).order_by(WeeklyHours.day_of_week, WeeklyHours.opens_at))
    exceptions = db.scalars(
        select(HoursException).where(HoursException.date >= today).order_by(HoursException.date)
    )
    return HoursDTO(
        timezone=timezone,
        weekly=[WeeklyWindowDTO.model_validate(row) for row in weekly],
        exceptions=[HoursExceptionDTO.model_validate(row) for row in exceptions],
    )


@router.put("", response_model=HoursDTO)
def update_hours(payload: UpdateHoursDTO, db: Database, actor: Coordinator) -> HoursDTO:
    db.execute(delete(WeeklyHours))
    db.add_all(WeeklyHours(**window.model_dump()) for window in payload.weekly)
    record_audit(db, actor_id=actor.id, action=AuditAction.HOURS_UPDATE, target_type="hours")
    db.commit()
    return read_hours(db)


def _get_exception(db: Session, id: UUID) -> HoursException:
    item = db.get(HoursException, id)
    if item is None:
        raise AppError(404, "not_found", "Hours exception not found.")
    return item


def _save_exception(db: Session, actor: Account, item: HoursException, action: AuditAction) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        if getattr(exc.orig, "sqlstate", None) == "23505":
            raise AppError(
                409, "exception_exists", "An exception for this date already exists."
            ) from None
        raise
    record_audit(
        db, actor_id=actor.id, action=action, target_type="hours_exception", target_id=item.id
    )
    db.commit()


@router.post("/exceptions", response_model=AdminHoursExceptionDTO, status_code=201)
def create_exception(payload: HoursExceptionInputDTO, db: Database, actor: Coordinator):
    item = HoursException(**payload.model_dump())
    db.add(item)
    _save_exception(db, actor, item, AuditAction.HOURS_EXCEPTION_CREATE)
    return item


@router.patch("/exceptions/{id}", response_model=AdminHoursExceptionDTO)
def update_exception(id: UUID, payload: HoursExceptionInputDTO, db: Database, actor: Coordinator):
    item = _get_exception(db, id)
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    _save_exception(db, actor, item, AuditAction.HOURS_EXCEPTION_UPDATE)
    return item


@router.delete("/exceptions/{id}", response_model=AdminHoursExceptionDTO)
def delete_exception(id: UUID, db: Database, actor: Coordinator) -> AdminHoursExceptionDTO:
    item = _get_exception(db, id)
    result = AdminHoursExceptionDTO.model_validate(item)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.HOURS_EXCEPTION_DELETE,
        target_type="hours_exception",
        target_id=item.id,
    )
    db.delete(item)
    db.commit()
    return result
