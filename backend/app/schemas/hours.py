from datetime import date as Date
from datetime import time

from pydantic import BaseModel, ConfigDict


class WeeklyWindowDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    day_of_week: int
    opens_at: time
    closes_at: time


class HoursExceptionDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: Date
    is_closed: bool
    opens_at: time | None
    closes_at: time | None
    note: str | None


class HoursDTO(BaseModel):
    timezone: str
    weekly: list[WeeklyWindowDTO]
    exceptions: list[HoursExceptionDTO]
