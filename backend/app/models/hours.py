from datetime import date as Date
from datetime import time

from sqlalchemy import CheckConstraint, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class WeeklyHours(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "weekly_hours"
    __table_args__ = (
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="weekly_hours_day_of_week"),
    )

    day_of_week: Mapped[int] = mapped_column(SmallInteger)
    opens_at: Mapped[time]
    closes_at: Mapped[time]


class HoursException(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "hours_exceptions"
    __table_args__ = (
        CheckConstraint(
            "is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL)",
            name="hours_exception_times_required",
        ),
    )

    date: Mapped[Date] = mapped_column(unique=True)
    is_closed: Mapped[bool]
    opens_at: Mapped[time | None]
    closes_at: Mapped[time | None]
    note: Mapped[str | None] = mapped_column(String(200))
