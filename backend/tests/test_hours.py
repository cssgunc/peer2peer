from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.hours import (
    DateException,
    Schedule,
    WeeklyWindow,
    is_open_at,
    next_open_at,
    windows_between,
)


def local(day: int, hour: int, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, tzinfo=ZoneInfo("America/New_York"))


def test_evening() -> None:
    s = Schedule("America/New_York", [WeeklyWindow(0, time(18), time(22))], [])
    assert not is_open_at(s, local(26, 17))
    assert is_open_at(s, local(26, 18))
    assert is_open_at(s, local(26, 20))
    assert not is_open_at(s, local(26, 22))
    assert not is_open_at(s, local(26, 23))
    assert windows_between(s, local(26, 19), local(26, 20)) == [
        (local(26, 19).astimezone(UTC), local(26, 20).astimezone(UTC))
    ]


def test_overnight_survives_next_day_exception() -> None:
    s = Schedule(
        "America/New_York",
        [WeeklyWindow(0, time(22), time(2))],
        [DateException(date(2026, 10, 27), True, None, None)],
    )
    assert is_open_at(s, local(27, 1))
    assert not is_open_at(s, local(27, 3))


def test_next_open_skips_days_and_current_window() -> None:
    s = Schedule("America/New_York", [WeeklyWindow(2, time(18), time(22))], [])
    assert next_open_at(s, local(26, 12)) == local(28, 18).astimezone(UTC)
    assert next_open_at(s, local(28, 18)) == local(4, 18, 11).astimezone(UTC)
    assert next_open_at(s, local(28, 19)) == local(4, 18, 11).astimezone(UTC)


def test_exceptions_replace_windows() -> None:
    s = Schedule(
        "America/New_York",
        [WeeklyWindow(d, time(18), time(22)) for d in (0, 1)],
        [
            DateException(date(2026, 10, 26), True, None, None),
            DateException(date(2026, 10, 27), False, time(12), time(14)),
        ],
    )
    assert not is_open_at(s, local(26, 19))
    assert next_open_at(s, local(26, 12)) == local(27, 12).astimezone(UTC)
    assert is_open_at(s, local(27, 13))
    assert not is_open_at(s, local(27, 19))


def test_dst_offsets() -> None:
    s = Schedule("America/New_York", [WeeklyWindow(d, time(18), time(22)) for d in (5, 6)], [])
    assert windows_between(s, local(31, 0), local(2, 0, 11)) == [
        (datetime(2026, 10, 31, 22, tzinfo=UTC), datetime(2026, 11, 1, 2, tzinfo=UTC)),
        (datetime(2026, 11, 1, 23, tzinfo=UTC), datetime(2026, 11, 2, 3, tzinfo=UTC)),
    ]


def test_dst_overnight_lasts_five_hours() -> None:
    s = Schedule("America/New_York", [WeeklyWindow(5, time(23), time(3))], [])
    intervals = windows_between(s, local(31, 0), local(2, 0, 11))
    assert intervals == [
        (datetime(2026, 11, 1, 3, tzinfo=UTC), datetime(2026, 11, 1, 8, tzinfo=UTC))
    ]
    assert intervals[0][1] - intervals[0][0] == timedelta(hours=5)


def test_empty_and_horizon() -> None:
    s = Schedule("America/New_York", [], [])
    assert next_open_at(s, local(26, 12)) is None
    assert not is_open_at(s, local(26, 12))
    s.exceptions.append(DateException(date(2026, 11, 10), False, time(12), time(14)))
    assert next_open_at(s, local(26, 12)) is None
    assert next_open_at(s, local(27, 12)) is None  # DST adds an elapsed hour.
    assert next_open_at(s, local(27, 13)) == local(10, 12, 11).astimezone(UTC)


def test_equal_times_and_naive_input() -> None:
    s = Schedule("America/New_York", [WeeklyWindow(0, time(18), time(18))], [])
    assert is_open_at(s, local(27, 17))
    assert not is_open_at(s, local(27, 18))
    with pytest.raises(ValueError, match="timezone-aware"):
        is_open_at(s, datetime(2026, 10, 26))
