from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.hours import HoursException, WeeklyHours
from app.services.hours import DateException, Schedule, WeeklyWindow


def load_schedule(db: Session) -> Schedule:
    """Load all exceptions, including those outside the public API horizon."""
    weekly = db.scalars(select(WeeklyHours).order_by(WeeklyHours.day_of_week, WeeklyHours.opens_at))
    exceptions = db.scalars(select(HoursException).order_by(HoursException.date))
    return Schedule(
        timezone=get_settings().line_timezone,
        weekly=[WeeklyWindow(row.day_of_week, row.opens_at, row.closes_at) for row in weekly],
        exceptions=[
            DateException(row.date, row.is_closed, row.opens_at, row.closes_at)
            for row in exceptions
        ],
    )
