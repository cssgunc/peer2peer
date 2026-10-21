from datetime import datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.hours import HoursException, WeeklyHours
from app.schemas.hours import HoursDTO, HoursExceptionDTO, WeeklyWindowDTO

router = APIRouter(prefix="/hours", tags=["hours"])


@router.get("", response_model=HoursDTO)
def read_hours(db: Annotated[Session, Depends(get_db)]) -> HoursDTO:
    timezone = get_settings().line_timezone
    today = datetime.now(ZoneInfo(timezone)).date()
    weekly = db.scalars(select(WeeklyHours).order_by(WeeklyHours.day_of_week, WeeklyHours.opens_at))
    exceptions = db.scalars(
        select(HoursException)
        .where(HoursException.date.between(today, today + timedelta(days=60)))
        .order_by(HoursException.date)
    )
    return HoursDTO(
        timezone=timezone,
        weekly=[WeeklyWindowDTO.model_validate(row) for row in weekly],
        exceptions=[HoursExceptionDTO.model_validate(row) for row in exceptions],
    )
