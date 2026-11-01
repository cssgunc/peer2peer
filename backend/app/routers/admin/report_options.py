import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account
from app.models.report import ReportOption
from app.schemas.report import AdminReportOptionDTO, ReportOptionInputDTO
from app.services.audit import AuditAction, record_audit

Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]

router = APIRouter(
    prefix="/admin/report-options",
    tags=["admin report"],
    dependencies=[Depends(require_coordinator)],
)


def get_item(db: Session, id: uuid.UUID) -> ReportOption:
    item = db.get(ReportOption, id)
    if item is None:
        raise HTTPException(status_code=404, detail="Report option not found")
    return item


@router.get("", response_model=list[AdminReportOptionDTO])
def list_admin_report_options(db: Database, actor: Coordinator) -> list[AdminReportOptionDTO]:
    items = db.scalars(
        select(ReportOption).order_by(
            ReportOption.display_order,
            ReportOption.id,
        )
    ).all()
    return [AdminReportOptionDTO.model_validate(item) for item in items]


@router.post("", response_model=AdminReportOptionDTO, status_code=201)
def create_report_option(data: ReportOptionInputDTO, db: Database, actor: Coordinator):
    values = data.model_dump()
    item = ReportOption(**values)
    db.add(item)
    db.flush()
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.REPORT_OPTION_CREATE,
        target_type="report_option",
        target_id=item.id,
    )
    db.commit()
    return item


@router.patch("/{id}", response_model=AdminReportOptionDTO)
def update_report_option(
    id: uuid.UUID, data: ReportOptionInputDTO, db: Database, actor: Coordinator
):
    item = get_item(db, id)
    values = data.model_dump()

    for field, value in values.items():
        setattr(item, field, value)

    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.REPORT_OPTION_UPDATE,
        target_type="report_option",
        target_id=item.id,
        details={"fields": sorted(values)},
    )
    db.commit()
    return item
