import logging
from collections.abc import Iterator
from datetime import UTC, datetime, time, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.models import FeedbackSubmission
from app.models.feedback import start_of_utc_day
from app.routers.feedback import (
    GLOBAL_KEY,
    GLOBAL_LIMIT,
    GLOBAL_WINDOW_SECONDS,
    PER_IP_LIMIT,
)
from app.security.rate_limit import limiter

# Documentation-range address (RFC 5737), distinctive enough to search for.
CLIENT_IP = "203.0.113.7"
# Distinctive enough that finding it anywhere means the body leaked.
SECRET_BODY = "feedback-canary-7f3a9c: the waiting room music is too loud"


@pytest.fixture
def ip_client(db: Session) -> Iterator[TestClient]:
    """A client with a fixed, searchable IP so tests can check it is never stored."""
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, client=(CLIENT_IP, 50000)) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def stored(db: Session) -> list[FeedbackSubmission]:
    return list(db.scalars(select(FeedbackSubmission)))


def test_valid_submission_is_stored_with_a_midnight_timestamp(
    client: TestClient, db: Session
) -> None:
    before = start_of_utc_day()
    response = client.post("/api/feedback", json={"body": "  Thanks for being here.  "})
    after = start_of_utc_day()

    assert response.status_code == 204
    assert response.content == b""
    [row] = stored(db)
    assert row.body == "Thanks for being here."  # trimmed
    assert row.read_at is None
    assert row.created_at in (before, after)  # (before == after unless the test spans midnight)
    # Compare in UTC: the database may hand the value back in its own session time zone.
    created_utc = row.created_at.astimezone(UTC)
    assert created_utc.time() == time(0, 0)


def test_start_of_utc_day_uses_the_utc_date() -> None:
    eastern = timezone(timedelta(hours=-4))
    # 11:30 PM Eastern is already the next day in UTC.
    late_evening = datetime(2026, 10, 18, 23, 30, tzinfo=eastern)

    assert start_of_utc_day(late_evening) == datetime(2026, 10, 19, tzinfo=UTC)


def test_body_at_the_limit_is_accepted(client: TestClient, db: Session) -> None:
    response = client.post("/api/feedback", json={"body": "x" * 2000})

    assert response.status_code == 204
    assert len(stored(db)[0].body) == 2000


@pytest.mark.parametrize(
    "payload",
    [
        {"body": ""},
        {"body": "   \n\t "},  # empty once trimmed
        {"body": "x" * 2001},
        {"body": "  " + "x" * 2001 + "  "},
        {},
        {"body": None},
    ],
    ids=["empty", "whitespace-only", "too-long", "too-long-after-trim", "missing", "null"],
)
def test_invalid_bodies_return_422_and_store_nothing(
    client: TestClient, db: Session, payload: dict[str, object]
) -> None:
    response = client.post("/api/feedback", json=payload)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert stored(db) == []


def test_error_response_never_echoes_the_body(client: TestClient) -> None:
    response = client.post("/api/feedback", json={"body": SECRET_BODY + "x" * 2000})

    assert response.status_code == 422
    assert "feedback-canary" not in response.text


def test_fourth_submission_in_ten_minutes_returns_429(client: TestClient, db: Session) -> None:
    for i in range(PER_IP_LIMIT):
        assert client.post("/api/feedback", json={"body": f"note {i}"}).status_code == 204

    response = client.post("/api/feedback", json={"body": "one too many"})

    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert int(response.headers["Retry-After"]) <= 600
    assert len(stored(db)) == PER_IP_LIMIT


def test_global_cap_applies_across_all_senders(client: TestClient, db: Session) -> None:
    # Fill the shared counter as if other senders had used it up this hour.
    for _ in range(GLOBAL_LIMIT):
        limiter.hit(f"feedback-global:{GLOBAL_KEY}", GLOBAL_LIMIT, GLOBAL_WINDOW_SECONDS)

    response = client.post("/api/feedback", json={"body": "first from this sender"})

    assert response.status_code == 429
    assert stored(db) == []


def test_body_and_ip_never_show_up_in_logs(
    ip_client: TestClient,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # The "app" logger is pinned to INFO, so lower it too; otherwise debug logs would slip by.
    with caplog.at_level(logging.DEBUG), caplog.at_level(logging.DEBUG, logger="app"):
        assert ip_client.post("/api/feedback", json={"body": SECRET_BODY}).status_code == 204
        too_long = {"body": SECRET_BODY + "x" * 2000}
        assert ip_client.post("/api/feedback", json=too_long).status_code == 422

    # The request log line itself is expected; only its contents are checked.
    assert any(
        r.name == "app.request" and "/api/feedback" in r.getMessage() for r in caplog.records
    )
    captured = capsys.readouterr()
    for output in (caplog.text, captured.out, captured.err):
        assert "feedback-canary" not in output
        assert CLIENT_IP not in output


def test_stored_row_holds_nothing_that_could_identify_the_sender(
    ip_client: TestClient, db: Session
) -> None:
    assert ip_client.post("/api/feedback", json={"body": SECRET_BODY}).status_code == 204

    columns = {
        column["name"]
        for column in inspect(db.connection()).get_columns(FeedbackSubmission.__tablename__)
    }
    assert columns == {"id", "body", "created_at", "read_at"}

    [row] = stored(db)
    # UUIDv7 would embed the exact submission time; v4 is random.
    assert row.id.version == 4
    assert row.created_at == start_of_utc_day(row.created_at)
    raw = db.execute(text("SELECT * FROM feedback_submissions")).one()
    assert all(CLIENT_IP not in str(value) for value in raw)
