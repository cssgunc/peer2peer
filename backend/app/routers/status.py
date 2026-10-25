from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.status import StatusDTO
from app.services.hours import next_open_at
from app.services.schedule import load_schedule
from app.services.shifts import is_line_online
from app.services.site_settings import get_setting

router = APIRouter(prefix="/status", tags=["status"])


@router.get("", response_model=StatusDTO)
def read_status(response: Response, db: Annotated[Session, Depends(get_db)]) -> StatusDTO:
    now = datetime.now(UTC)
    launch_at = get_setting(db, "line_launch_at")
    if launch_at is not None:
        launch_at = launch_at.astimezone(UTC)
    response.headers["Cache-Control"] = "public, max-age=15"
    return StatusDTO(
        is_online=is_line_online(db, now),
        next_open_at=next_open_at(load_schedule(db), now),
        line_launched=launch_at is None or launch_at <= now,
        line_launch_at=launch_at,
    )
