from datetime import date as Date
from datetime import time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class WeeklyWindowInputDTO(WeeklyWindowDTO):
    day_of_week: int = Field(ge=0, le=6)

    @model_validator(mode="after")
    def validate_times(self) -> WeeklyWindowInputDTO:
        if self.opens_at.tzinfo is not None or self.closes_at.tzinfo is not None:
            raise ValueError("Times must be local times without a timezone")
        if self.opens_at == self.closes_at:
            raise ValueError("opens_at must differ from closes_at")
        return self


class UpdateHoursDTO(BaseModel):
    weekly: list[WeeklyWindowInputDTO]

    @model_validator(mode="after")
    def validate_overlaps(self) -> UpdateHoursDTO:
        windows = sorted(self.weekly, key=lambda w: (w.day_of_week, w.opens_at))
        for previous, current in zip(windows, windows[1:], strict=False):
            if previous.day_of_week == current.day_of_week and (
                previous.closes_at < previous.opens_at or current.opens_at < previous.closes_at
            ):
                raise ValueError("Weekly windows on the same day cannot overlap")
        return self


class HoursExceptionInputDTO(BaseModel):
    date: Date
    is_closed: bool
    opens_at: time | None = None
    closes_at: time | None = None
    note: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def validate_times(self) -> HoursExceptionInputDTO:
        if not self.is_closed and (self.opens_at is None or self.closes_at is None):
            raise ValueError("An open exception requires both opens_at and closes_at")
        for value in (self.opens_at, self.closes_at):
            if value is not None and value.tzinfo is not None:
                raise ValueError("Times must be local times without a timezone")
        if self.opens_at is not None and self.opens_at == self.closes_at:
            raise ValueError("opens_at must differ from closes_at")
        return self


class AdminHoursExceptionDTO(HoursExceptionDTO):
    id: UUID


class AdminHoursDTO(BaseModel):
    timezone: str
    weekly: list[WeeklyWindowDTO]
    exceptions: list[AdminHoursExceptionDTO]
