from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_staff
from app.models.report import ReportOption, ReportOptionKind
from app.schemas.report import ReportOptionDTO, ReportOptionsDTO

router = APIRouter(
    prefix="/portal/report-options", tags=["portal"], dependencies=[Depends(require_staff)]
)


@router.get("", response_model=ReportOptionsDTO)
def list_report_options(db: Annotated[Session, Depends(get_db)]) -> ReportOptionsDTO:
    options = db.scalars(
        select(ReportOption)
        .where(ReportOption.is_active.is_(True))
        .order_by(ReportOption.display_order, ReportOption.id)
    ).all()

    topics = [
        ReportOptionDTO(id=option.id, label=option.label)
        for option in options
        if option.kind == ReportOptionKind.TOPIC
    ]

    outcomes = [
        ReportOptionDTO(id=option.id, label=option.label)
        for option in options
        if option.kind == ReportOptionKind.OUTCOME
    ]

    return ReportOptionsDTO(
        topics=topics,
        outcomes=outcomes,
    )
