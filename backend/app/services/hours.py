"""Scheduled opening hours only; responder presence determines online status."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass
class WeeklyWindow:
    day_of_week: int
    opens_at: time
    closes_at: time


@dataclass
class DateException:
    date: date
    is_closed: bool
    opens_at: time | None
    closes_at: time | None


@dataclass
class Schedule:
    timezone: str
    weekly: list[WeeklyWindow]
    exceptions: list[DateException]


def _utc(value: datetime) -> datetime:
    if value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(UTC)


def windows_between(
    schedule: Schedule, start: datetime, end: datetime
) -> list[tuple[datetime, datetime]]:
    """Return sorted UTC intervals clipped to the half-open range [start, end).

    Exceptions replace windows starting on their date, including overnight ones.
    Ambiguous local times use zoneinfo's first occurrence (fold=0); nonexistent
    local times use its pre-transition offset.
    """
    start, end = _utc(start), _utc(end)
    if end <= start:
        return []
    zone = ZoneInfo(schedule.timezone)
    exceptions = {exception.date: exception for exception in schedule.exceptions}
    day = start.astimezone(zone).date() - timedelta(days=1)
    last_day = end.astimezone(zone).date()
    intervals: list[tuple[datetime, datetime]] = []
    while day <= last_day:
        hours: list[tuple[time, time]] = []
        exception = exceptions.get(day)
        if exception is not None:
            if not exception.is_closed:
                if exception.opens_at is None or exception.closes_at is None:
                    raise ValueError("custom-hours exceptions require opening and closing times")
                hours.append((exception.opens_at, exception.closes_at))
        else:
            hours = [
                (window.opens_at, window.closes_at)
                for window in schedule.weekly
                if window.day_of_week == day.weekday()
            ]
        for opens_at, closes_at in hours:
            close_day = day + timedelta(days=closes_at <= opens_at)
            opening = datetime.combine(day, opens_at, zone).astimezone(UTC)
            closing = datetime.combine(close_day, closes_at, zone).astimezone(UTC)
            if opening < end and closing > start:
                intervals.append((max(opening, start), min(closing, end)))
        day += timedelta(days=1)
    return sorted(intervals)


def is_open_at(schedule: Schedule, at: datetime) -> bool:
    """Whether any scheduled window contains at, including its opening instant."""
    at = _utc(at)
    return bool(windows_between(schedule, at, at + timedelta(microseconds=1)))


def next_open_at(schedule: Schedule, at: datetime) -> datetime | None:
    """Return the next window start strictly after at, within 14 elapsed days."""
    at = _utc(at)
    horizon = at + timedelta(days=14)
    for opening, _ in windows_between(schedule, at, horizon + timedelta(microseconds=1)):
        if at < opening <= horizon:
            return opening
    return None
