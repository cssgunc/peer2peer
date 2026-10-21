from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.hours import HoursException, WeeklyHours
from app.seed import seed_hours
from app.services.hours import DateException, Schedule, WeeklyWindow, is_open_at, next_open_at
from app.services.schedule import load_schedule


@pytest.fixture
def frozen_today() -> Iterator[date]:
    # Oct 21 in UTC is still Oct 20 at 11 PM Eastern.
    instant = datetime(2026, 10, 21, 3, tzinfo=UTC)
    with patch("app.routers.hours.datetime") as clock:
        clock.now.side_effect = lambda zone: instant.astimezone(zone)
        yield date(2026, 10, 20)


def test_empty_schedule(client: TestClient) -> None:
    response = client.get("/api/hours")
    assert response.status_code == 200
    assert response.json() == {"timezone": "America/New_York", "weekly": [], "exceptions": []}


def test_weekly_windows_sorted(client: TestClient, db: Session) -> None:
    windows = [(6, 19), (0, 20), (3, 19), (0, 9)]
    db.add_all(
        WeeklyHours(day_of_week=day, opens_at=time(hour), closes_at=time(23))
        for day, hour in windows
    )
    db.flush()
    response = client.get("/api/hours")
    assert response.status_code == 200
    assert response.json()["weekly"] == [
        {"day_of_week": day, "opens_at": f"{hour:02}:00:00", "closes_at": "23:00:00"}
        for day, hour in sorted(windows)
    ]


def test_exception_horizon_and_eastern_today(
    client: TestClient, db: Session, frozen_today: date
) -> None:
    for offset in (61, 60, 1, 0, -1):
        db.add(
            HoursException(
                date=frozen_today + timedelta(days=offset), is_closed=True, note="Closed"
            )
        )
    db.flush()
    response = client.get("/api/hours")
    assert response.status_code == 200
    assert response.json()["exceptions"] == [
        {
            "date": (frozen_today + timedelta(days=offset)).isoformat(),
            "is_closed": True,
            "opens_at": None,
            "closes_at": None,
            "note": "Closed",
        }
        for offset in (0, 1, 60)
    ]


def test_load_schedule_works_with_calculations(db: Session) -> None:
    db.add(WeeklyHours(day_of_week=0, opens_at=time(19), closes_at=time(23)))
    db.add_all(
        [
            HoursException(
                date=date(2026, 10, 20), is_closed=False, opens_at=time(20), closes_at=time(22)
            ),
            HoursException(date=date(2027, 1, 4), is_closed=True),
        ]
    )
    db.flush()
    schedule = load_schedule(db)
    assert schedule == Schedule(
        timezone="America/New_York",
        weekly=[WeeklyWindow(0, time(19), time(23))],
        exceptions=[
            DateException(date(2026, 10, 20), False, time(20), time(22)),
            DateException(date(2027, 1, 4), True, None, None),
        ],
    )
    assert is_open_at(schedule, datetime(2026, 10, 20, 0, tzinfo=UTC))
    assert next_open_at(schedule, datetime(2026, 10, 20, 4, tzinfo=UTC)) == datetime(
        2026, 10, 21, 0, tzinfo=UTC
    )
    assert not is_open_at(schedule, datetime(2027, 1, 5, 1, tzinfo=UTC))


@pytest.mark.parametrize("day", [-1, 7])
def test_day_constraint(db: Session, day: int) -> None:
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(WeeklyHours(day_of_week=day, opens_at=time(19), closes_at=time(23)))
        db.flush()


@pytest.mark.parametrize("opens,closes", [(None, None), (time(19), None), (None, time(23))])
def test_exception_requires_both_times(
    db: Session, opens: time | None, closes: time | None
) -> None:
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(
            HoursException(
                date=date(2026, 10, 20), is_closed=False, opens_at=opens, closes_at=closes
            )
        )
        db.flush()


def test_exception_date_unique(db: Session) -> None:
    with pytest.raises(IntegrityError), db.begin_nested():
        db.add_all([HoursException(date=date(2026, 10, 20), is_closed=True) for _ in range(2)])
        db.flush()


def test_seed_hours_idempotent(db: Session) -> None:
    seed_hours(db)
    seed_hours(db)
    assert db.scalar(select(func.count()).select_from(WeeklyHours)) == 5
    assert db.scalar(select(func.count()).select_from(HoursException)) == 1
    assert [(w.day_of_week, w.opens_at, w.closes_at) for w in load_schedule(db).weekly] == [
        (day, time(19), time(23)) for day in (0, 1, 2, 3, 6)
    ]
