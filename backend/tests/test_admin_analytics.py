import csv
from datetime import UTC, datetime, timedelta
from io import StringIO

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Account,
    AccountRole,
    Channel,
    Conversation,
    ConversationReport,
    ConversationReportTopic,
    ConversationStatus,
    ReportOption,
    ReportOptionKind,
)
from tests.test_sessions import make_account, signed_in

URL = "/api/admin/analytics/line"
DATES = {"start": "2026-11-01", "end": "2026-11-03"}
OPENED = datetime(2026, 11, 1, 17, tzinfo=UTC)


@pytest.fixture
def coordinator(db: Session, client: TestClient) -> Account:
    account = make_account(db, role=AccountRole.COORDINATOR)
    signed_in(db, client, account, datetime.now(UTC))
    return account


def add_conversation(
    db: Session,
    *,
    opened_at: datetime = OPENED,
    channel: Channel = Channel.WEB,
    response: int | None = None,
    duration: int | None = None,
    messages: int = 0,
    after_hours: bool = False,
) -> Conversation:
    conversation = Conversation(
        channel=channel,
        opened_at=opened_at,
        first_response_at=opened_at + timedelta(seconds=response) if response is not None else None,
        closed_at=opened_at + timedelta(seconds=duration) if duration is not None else None,
        status=ConversationStatus.CLOSED if duration is not None else ConversationStatus.QUEUED,
        message_count=messages,
        opened_after_hours=after_hours,
    )
    db.add(conversation)
    db.flush()
    return conversation


def add_option(db: Session, label: str, kind: ReportOptionKind) -> ReportOption:
    option = ReportOption(kind=kind, label=label, display_order=0, is_active=True)
    db.add(option)
    db.flush()
    return option


def add_report(
    db: Session,
    conversation: Conversation,
    account: Account,
    topics: list[ReportOption],
    outcome: ReportOption,
    confidence: int = 3,
) -> None:
    report = ConversationReport(
        conversation_id=conversation.id,
        account_id=account.id,
        outcome_id=outcome.id,
        confidence=confidence,
        # Deliberately outside the requested window: reports follow the conversation's date.
        submitted_at=OPENED + timedelta(days=10),
    )
    db.add(report)
    db.flush()
    db.add_all(ConversationReportTopic(report_id=report.id, option_id=topic.id) for topic in topics)
    db.flush()


def test_totals_and_percentiles(db: Session, client: TestClient, coordinator: Account) -> None:
    # Response [10,20,30,40,50]: median=30, p90=46. Missing timestamps don't add zeros.
    # Duration [100,200,300,400]: median=250. Messages [0,2,4,6,8,10]: median=5.
    for index in range(6):
        add_conversation(
            db,
            response=(index + 1) * 10 if index < 5 else None,
            duration=(index + 1) * 100 if index < 4 else None,
            messages=index * 2,
            after_hours=index < 2,
        )
    add_conversation(db, opened_at=OPENED - timedelta(days=1), response=999, messages=999)
    add_conversation(db, opened_at=OPENED + timedelta(days=3), response=999, messages=999)
    db.commit()

    response = client.get(URL, params=DATES)

    assert response.status_code == 200
    assert response.json() == {
        "range": DATES,
        "conversations_total": 6,
        "by_channel": {"web": 6},
        "first_response_seconds": {"median": 30.0, "p90": 46.0},
        "duration_seconds": {"median": 250.0},
        "message_count": {"median": 5.0},
        "after_hours_attempts": 2,
        "topics": [],
        "outcomes": [],
        "confidence_avg": None,
        "series": [
            {"date": "2026-11-01", "conversations": 6},
            {"date": "2026-11-02", "conversations": 0},
            {"date": "2026-11-03", "conversations": 0},
        ],
        "suppression_threshold": 5,
    }


def test_suppression_and_channel_filter(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    topic = add_option(db, "Academic stress", ReportOptionKind.TOPIC)
    rare_topic = add_option(db, "Rare topic", ReportOptionKind.TOPIC)
    outcome = add_option(db, "Felt heard", ReportOptionKind.OUTCOME)
    rare_outcome = add_option(db, "Rare outcome", ReportOptionKind.OUTCOME)
    for index in range(9):
        web = index < 5
        conversation = add_conversation(
            db,
            channel=Channel.WEB if web else Channel.SMS,
            response=10 if web else 100,
            duration=20 if web else 200,
            messages=2 if web else 10,
            after_hours=not web,
        )
        add_report(
            db,
            conversation,
            coordinator,
            [topic, rare_topic] if index < 4 else [topic] if web else [],
            outcome if web else rare_outcome,
            confidence=1 if web else 5,
        )
    topic.is_active = False  # Retired options still belong in historical reporting.
    outcome.is_active = False
    db.commit()

    result = client.get(URL, params=DATES).json()
    assert result["conversations_total"] == 9
    assert result["by_channel"] == {"web": 5}
    assert result["topics"] == [{"label": "Academic stress", "count": 5}]
    assert result["outcomes"] == [{"label": "Felt heard", "count": 5}]
    assert result["confidence_avg"] == pytest.approx(25 / 9)

    web_result = client.get(URL, params={**DATES, "channel": "web"}).json()
    assert web_result["conversations_total"] == 5
    assert web_result["by_channel"] == {"web": 5}
    assert web_result["first_response_seconds"] == {"median": 10, "p90": 10}
    assert web_result["duration_seconds"] == {"median": 20}
    assert web_result["message_count"] == {"median": 2}
    assert web_result["confidence_avg"] == 1
    assert web_result["after_hours_attempts"] == 0
    assert web_result["series"][0]["conversations"] == 5

    sms_result = client.get(URL, params={**DATES, "channel": "sms"}).json()
    assert sms_result["conversations_total"] == 4
    assert sms_result["by_channel"] == {}
    assert sms_result["topics"] == []
    assert sms_result["outcomes"] == []
    assert sms_result["confidence_avg"] is None
    assert sms_result["first_response_seconds"] == {"median": 100, "p90": 100}
    assert sms_result["duration_seconds"] == {"median": 200}
    assert sms_result["message_count"] == {"median": 10}
    assert sms_result["after_hours_attempts"] == 4
    assert sms_result["series"][0]["conversations"] == 4


def test_report_suppression_counts_reports_not_conversations(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    topic = add_option(db, "Topic", ReportOptionKind.TOPIC)
    outcome = add_option(db, "Outcome", ReportOptionKind.OUTCOME)
    conversations = [add_conversation(db) for _ in range(8)]
    for conversation in conversations[:4]:
        add_report(db, conversation, coordinator, [topic], outcome, confidence=4)
    db.commit()
    result = client.get(URL, params=DATES).json()
    assert result["conversations_total"] == 8
    assert result["confidence_avg"] is None
    assert result["topics"] == []
    assert result["outcomes"] == []

    add_report(db, conversations[4], coordinator, [topic], outcome, confidence=1)
    db.commit()
    result = client.get(URL, params=DATES).json()
    assert result["confidence_avg"] == pytest.approx(3.4)
    assert result["topics"] == [{"label": "Topic", "count": 5}]
    assert result["outcomes"] == [{"label": "Outcome", "count": 5}]


@pytest.mark.parametrize(
    ("day", "start_utc", "end_utc"),
    [
        ("2026-03-08", "2026-03-08T05:00:00+00:00", "2026-03-09T04:00:00+00:00"),
        ("2026-11-01", "2026-11-01T04:00:00+00:00", "2026-11-02T05:00:00+00:00"),
    ],
)
def test_local_day_boundaries_include_11pm_and_handle_dst(
    db: Session,
    client: TestClient,
    coordinator: Account,
    day: str,
    start_utc: str,
    end_utc: str,
) -> None:
    start, end = datetime.fromisoformat(start_utc), datetime.fromisoformat(end_utc)
    for opened in [
        start - timedelta(microseconds=1),
        start,
        end - timedelta(hours=1),  # 11pm Eastern, already the next UTC day.
        end - timedelta(microseconds=1),
        end,
    ]:
        add_conversation(db, opened_at=opened)
    db.commit()

    result = client.get(URL, params={"start": day, "end": day}).json()

    assert result["conversations_total"] == 3
    assert result["series"] == [{"date": day, "conversations": 3}]


def test_timezone_uses_configuration(
    db: Session, client: TestClient, coordinator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "line_timezone", "America/Los_Angeles")
    add_conversation(db, opened_at=datetime(2026, 11, 2, 7, tzinfo=UTC))
    db.commit()
    result = client.get(URL, params=DATES).json()
    assert result["series"][0] == {"date": "2026-11-01", "conversations": 1}
    assert result["series"][1] == {"date": "2026-11-02", "conversations": 0}


def test_empty_range(db: Session, client: TestClient, coordinator: Account) -> None:
    result = client.get(URL, params=DATES).json()
    assert result["conversations_total"] == result["after_hours_attempts"] == 0
    assert result["first_response_seconds"] == {"median": None, "p90": None}
    assert result["duration_seconds"] == result["message_count"] == {"median": None}
    assert result["confidence_avg"] is None
    assert result["by_channel"] == {}
    assert result["topics"] == result["outcomes"] == []
    assert len(result["series"]) == 3
    assert all(day["conversations"] == 0 for day in result["series"])


@pytest.mark.parametrize("suffix", ["", ".csv"])
@pytest.mark.parametrize(
    "params",
    [
        {"start": "2026-11-02", "end": "2026-11-01"},
        {"start": "2025-01-01", "end": "2026-01-02"},  # 367 inclusive days
        {"start": "not-a-date"},
        {"end": "2026-02-30"},
        {"end": "9999-12-31"},
        {"end": "0001-01-01"},
    ],
)
def test_invalid_ranges(
    client: TestClient, coordinator: Account, suffix: str, params: dict[str, str]
) -> None:
    assert client.get(URL + suffix, params=params).status_code == 422


def test_invalid_channel(client: TestClient, coordinator: Account) -> None:
    assert client.get(URL, params={**DATES, "channel": "email"}).status_code == 422


def test_maximum_inclusive_range(client: TestClient, coordinator: Account) -> None:
    response = client.get(URL, params={"start": "2025-01-01", "end": "2026-01-01"})
    assert response.status_code == 200
    assert len(response.json()["series"]) == 366


def test_default_and_partial_ranges(
    client: TestClient, coordinator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.routers.admin import analytics

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            # Still Nov 16 in New York.
            return datetime(2026, 11, 17, 2, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(analytics, "datetime", Clock)
    result = client.get(URL).json()
    assert result["range"] == {"start": "2026-10-18", "end": "2026-11-16"}
    assert len(result["series"]) == 30
    assert client.get(URL, params={"end": "2026-06-30"}).json()["range"] == {
        "start": "2026-06-01",
        "end": "2026-06-30",
    }
    assert client.get(URL, params={"start": "2026-11-01"}).json()["range"] == {
        "start": "2026-11-01",
        "end": "2026-11-16",
    }


def test_csv_exports_only_suppressed_aggregates_and_survives_purge(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    topic = add_option(db, 'Academic, "stress"\nand more', ReportOptionKind.TOPIC)
    rare = add_option(db, "Hidden topic", ReportOptionKind.TOPIC)
    outcome = add_option(db, "=1+1", ReportOptionKind.OUTCOME)
    conversations = []
    for index in range(5):
        conversation = add_conversation(db, response=10, duration=100, messages=12)
        # Retention leaves metadata and reports, with no texter or message rows.
        conversation.messages_purged_at = OPENED + timedelta(days=31)
        conversations.append(conversation)
        add_report(db, conversation, coordinator, [topic, rare] if index < 4 else [topic], outcome)
    add_conversation(db, channel=Channel.SMS)
    db.commit()

    response = client.get(URL + ".csv", params=DATES)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == (
        'attachment; filename="line-analytics-2026-11-01-2026-11-03.csv"'
    )
    assert response.text.splitlines()[0] == "section,label,value"
    rows = list(csv.DictReader(StringIO(response.text)))
    values = {(row["section"], row["label"]): row["value"] for row in rows}
    assert values == {
        ("range", "start"): "2026-11-01",
        ("range", "end"): "2026-11-03",
        ("summary", "conversations_total"): "6",
        ("by_channel", "web"): "5",
        ("first_response_seconds", "median"): "10.0",
        ("first_response_seconds", "p90"): "10.0",
        ("duration_seconds", "median"): "100.0",
        ("message_count", "median"): "12.0",
        ("summary", "after_hours_attempts"): "0",
        ("topics", topic.label): "5",
        ("outcomes", "'=1+1"): "5",
        ("summary", "confidence_avg"): "3.0",
        ("series", "2026-11-01"): "6",
        ("series", "2026-11-02"): "0",
        ("series", "2026-11-03"): "0",
        ("summary", "suppression_threshold"): "5",
    }
    assert "Hidden topic" not in response.text
    assert "sms" not in response.text
    assert all(str(conversation.id) not in response.text for conversation in conversations)
    assert str(coordinator.id) not in response.text
    assert str(topic.id) not in response.text


def test_csv_null_metrics_are_empty_cells(client: TestClient, coordinator: Account) -> None:
    response = client.get(URL + ".csv", params=DATES)
    values = {
        (row["section"], row["label"]): row["value"]
        for row in csv.DictReader(StringIO(response.text))
    }
    assert values["summary", "confidence_avg"] == ""
    assert values["first_response_seconds", "median"] == ""
    assert values["duration_seconds", "median"] == ""


@pytest.mark.parametrize("suffix", ["", ".csv"])
def test_responders_get_403(db: Session, client: TestClient, suffix: str) -> None:
    signed_in(db, client, make_account(db), datetime.now(UTC))
    assert client.get(URL + suffix, params=DATES).status_code == 403


@pytest.mark.parametrize("suffix", ["", ".csv"])
def test_anonymous_requests_get_401(client: TestClient, suffix: str) -> None:
    assert client.get(URL + suffix, params=DATES).status_code == 401
