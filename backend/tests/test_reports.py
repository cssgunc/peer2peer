import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Conversation,
    ConversationReport,
    ConversationReportTopic,
    ConversationStatus,
    ReportOption,
    ReportOptionKind,
)
from app.services.assignment import eligible_responders
from app.services.shifts import start_shift
from app.services.site_settings import set_setting
from tests.test_assignment import make_conversation
from tests.test_sessions import make_account, signed_in


def report_url(conversation: Conversation) -> str:
    return f"/api/portal/conversations/{conversation.id}/report"


def make_option(db: Session, kind: ReportOptionKind, *, is_active: bool = True) -> ReportOption:
    option = ReportOption(kind=kind, label=f"{kind} option", display_order=0, is_active=is_active)
    db.add(option)
    db.flush()
    return option


@pytest.fixture
def topic(db: Session) -> ReportOption:
    return make_option(db, ReportOptionKind.TOPIC)


@pytest.fixture
def outcome(db: Session) -> ReportOption:
    return make_option(db, ReportOptionKind.OUTCOME)


@pytest.fixture
def account(db: Session) -> Account:
    return make_account(db)


def closed_conversation(db: Session, account: Account) -> Conversation:
    return make_conversation(db, account=account, status=ConversationStatus.CLOSED)


def report_body(topic_ids: list[uuid.UUID], outcome_id: uuid.UUID) -> dict[str, object]:
    return {
        "topic_ids": [str(topic_id) for topic_id in topic_ids],
        "outcome_id": str(outcome_id),
        "confidence": 4,
    }


def test_valid_report_is_saved_with_its_topics(
    db: Session,
    client: TestClient,
    account: Account,
    topic: ReportOption,
    outcome: ReportOption,
) -> None:
    other_topic = make_option(db, ReportOptionKind.TOPIC)
    conversation = closed_conversation(db, account)
    signed_in(db, client, account, datetime.now(UTC))

    response = client.post(
        report_url(conversation), json=report_body([topic.id, other_topic.id], outcome.id)
    )

    assert response.status_code == 201
    report = db.scalars(
        select(ConversationReport).where(ConversationReport.conversation_id == conversation.id)
    ).one()
    assert report.account_id == account.id
    assert report.outcome_id == outcome.id
    assert report.confidence == 4
    assert set(
        db.scalars(
            select(ConversationReportTopic.option_id).where(
                ConversationReportTopic.report_id == report.id
            )
        )
    ) == {topic.id, other_topic.id}


def test_retired_option_is_rejected(
    db: Session,
    client: TestClient,
    account: Account,
    topic: ReportOption,
    outcome: ReportOption,
) -> None:
    retired = make_option(db, ReportOptionKind.TOPIC, is_active=False)
    conversation = closed_conversation(db, account)
    signed_in(db, client, account, datetime.now(UTC))

    response = client.post(
        report_url(conversation), json=report_body([topic.id, retired.id], outcome.id)
    )

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_option"


def test_outcome_id_as_topic_is_rejected(
    db: Session, client: TestClient, account: Account, outcome: ReportOption
) -> None:
    conversation = closed_conversation(db, account)
    signed_in(db, client, account, datetime.now(UTC))

    response = client.post(report_url(conversation), json=report_body([outcome.id], outcome.id))

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_option"


def test_duplicate_report_gives_409(
    db: Session,
    client: TestClient,
    account: Account,
    topic: ReportOption,
    outcome: ReportOption,
) -> None:
    conversation = closed_conversation(db, account)
    signed_in(db, client, account, datetime.now(UTC))
    body = report_body([topic.id], outcome.id)

    assert client.post(report_url(conversation), json=body).status_code == 201
    response = client.post(report_url(conversation), json=body)

    assert response.status_code == 409
    assert response.json()["code"] == "report_exists"


def test_someone_elses_conversation_gives_404(
    db: Session,
    client: TestClient,
    account: Account,
    topic: ReportOption,
    outcome: ReportOption,
) -> None:
    other = make_account(db, email="other@unc.edu")
    conversation = closed_conversation(db, other)
    signed_in(db, client, account, datetime.now(UTC))

    response = client.post(report_url(conversation), json=report_body([topic.id], outcome.id))

    assert response.status_code == 404


def test_open_conversation_cannot_be_reported(
    db: Session,
    client: TestClient,
    account: Account,
    topic: ReportOption,
    outcome: ReportOption,
) -> None:
    conversation = make_conversation(db, account=account, status=ConversationStatus.ACTIVE)
    signed_in(db, client, account, datetime.now(UTC))

    response = client.post(report_url(conversation), json=report_body([topic.id], outcome.id))

    assert response.status_code == 404


def test_unfiled_report_blocks_assignment_until_filed(
    db: Session,
    client: TestClient,
    account: Account,
    topic: ReportOption,
    outcome: ReportOption,
) -> None:
    now = datetime.now(UTC)
    start_shift(db, account, now)
    closed = closed_conversation(db, account)
    queued = make_conversation(db)

    assert eligible_responders(db, now) == []

    signed_in(db, client, account, now)
    assert (
        client.post(report_url(closed), json=report_body([topic.id], outcome.id)).status_code == 201
    )

    db.refresh(queued)
    assert queued.assigned_account_id == account.id
    assert queued.status == ConversationStatus.ACTIVE


def test_unfiled_report_does_not_block_assignment_when_setting_is_off(
    db: Session, account: Account
) -> None:
    now = datetime.now(UTC)
    set_setting(db, "report_required", False, None)
    start_shift(db, account, now)
    closed_conversation(db, account)

    assert eligible_responders(db, now) == [account]
