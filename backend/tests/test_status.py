from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.account import Account, AccountRole
from app.models.hours import HoursException, WeeklyHours
from app.models.shift import ShiftEndReason
from app.services.shifts import end_shift, start_shift
from app.services.site_settings import set_setting

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)


@pytest.fixture(autouse=True)
def frozen_clock() -> Iterator[None]:
    with patch("app.routers.status.datetime") as clock:
        clock.now.return_value = NOW
        yield


@pytest.fixture
def account(db: Session) -> Account:
    account = Account(
        email="status-test@unc.edu",
        display_name="Status test responder",
        password_hash="unused-test-hash",
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.flush()
    return account


def test_empty_status_and_cache_header(client: TestClient) -> None:
    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "public, max-age=15"
    assert response.json() == {
        "is_online": False,
        "next_open_at": None,
        "line_launched": True,
        "line_launch_at": None,
    }


@pytest.mark.parametrize("age,online", [(0, True), (90, True), (91, False), (-1, False)])
def test_online_requires_recent_heartbeat(
    client: TestClient, db: Session, account: Account, age: int, online: bool
) -> None:
    start_shift(db, account, NOW - timedelta(seconds=age))
    body = client.get("/api/status").json()
    assert body["is_online"] is online
    # The public endpoint exposes neither staff details nor shift identifiers.
    assert set(body) == {"is_online", "next_open_at", "line_launched", "line_launch_at"}


def test_ended_shift_is_offline(client: TestClient, db: Session, account: Account) -> None:
    shift = start_shift(db, account, NOW)
    end_shift(db, shift, ShiftEndReason.MANUAL, NOW)
    db.flush()
    assert client.get("/api/status").json()["is_online"] is False


def test_posted_hours_do_not_make_line_online(client: TestClient, db: Session) -> None:
    # NOW is Monday at 8 AM Eastern, inside these posted hours.
    db.add(WeeklyHours(day_of_week=0, opens_at=time(7), closes_at=time(23)))
    db.flush()
    body = client.get("/api/status").json()
    assert body["is_online"] is False
    # The next window is after the DST change, at 7 AM EST on Nov 2.
    assert body["next_open_at"] == "2026-11-02T12:00:00Z"


def test_next_open_uses_schedule_and_exceptions(client: TestClient, db: Session) -> None:
    db.add_all(
        [
            WeeklyHours(day_of_week=0, opens_at=time(19), closes_at=time(23)),
            WeeklyHours(day_of_week=1, opens_at=time(19), closes_at=time(23)),
            HoursException(date=date(2026, 10, 26), is_closed=True),
            HoursException(
                date=date(2026, 10, 27),
                is_closed=False,
                opens_at=time(20),
                closes_at=time(22),
            ),
        ]
    )
    db.flush()
    assert client.get("/api/status").json()["next_open_at"] == "2026-10-28T00:00:00Z"


@pytest.mark.parametrize("offset,launched", [(-1, True), (0, True), (1, False)])
def test_launch_boundary(client: TestClient, db: Session, offset: int, launched: bool) -> None:
    launch_at = NOW + timedelta(seconds=offset)
    set_setting(db, "line_launch_at", launch_at, None)
    body = client.get("/api/status").json()
    assert body["line_launched"] is launched
    assert datetime.fromisoformat(body["line_launch_at"]) == launch_at


def test_launch_timestamp_is_utc(client: TestClient, db: Session) -> None:
    set_setting(db, "line_launch_at", "2026-10-26T09:00:00-04:00", None)
    body = client.get("/api/status").json()
    assert body["line_launch_at"] == "2026-10-26T13:00:00Z"
    assert body["line_launched"] is False


def test_presence_and_launch_are_independent(
    client: TestClient, db: Session, account: Account
) -> None:
    start_shift(db, account, NOW)
    set_setting(db, "line_launch_at", NOW + timedelta(days=1), None)
    body = client.get("/api/status").json()
    assert body["is_online"] is True
    assert body["line_launched"] is False
