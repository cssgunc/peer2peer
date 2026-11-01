from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AccountRole
from app.models.report import (
    ConversationReport,
    ReportOption,
    ReportOptionKind,
)
from tests.test_assignment import make_conversation
from tests.test_sessions import make_account, signed_in

PORTAL = "/api/portal/report-options"
ADMIN = "/api/admin/report-options"


def login(db: Session, client: TestClient) -> None:
    actor = make_account(db, role=AccountRole.COORDINATOR)
    signed_in(db, client, actor, datetime.now(UTC))


def test_retired_options_hidden_from_portal_but_listed_for_admin(
    db: Session, client: TestClient
) -> None:
    login(db, client)

    active_topic = ReportOption(
        kind=ReportOptionKind.TOPIC,
        label="Academic stress",
        display_order=2,
        is_active=True,
    )
    retired_topic = ReportOption(
        kind=ReportOptionKind.TOPIC, label="Old topic", display_order=1, is_active=False
    )
    active_outcome = ReportOption(
        kind=ReportOptionKind.OUTCOME,
        label="Felt heard",
        display_order=0,
        is_active=True,
    )

    db.add_all([active_topic, retired_topic, active_outcome])
    db.flush()

    portal_response = client.get(PORTAL)
    assert portal_response.status_code == 200
    portal = portal_response.json()
    assert portal["topics"] == [{"id": str(active_topic.id), "label": "Academic stress"}]
    assert portal["outcomes"] == [{"id": str(active_outcome.id), "label": "Felt heard"}]

    admin_response = client.get(ADMIN)
    assert admin_response.status_code == 200
    admin = admin_response.json()
    assert [option["id"] for option in admin] == [
        str(active_outcome.id),
        str(retired_topic.id),
        str(active_topic.id),
    ]
    assert (
        next(option for option in admin if option["id"] == str(retired_topic.id))["is_active"]
        is False
    )


def test_portal_report_options_ordering_by_display_order(db: Session, client: TestClient) -> None:
    login(db, client)

    later = ReportOption(
        kind=ReportOptionKind.TOPIC,
        label="Later",
        display_order=20,
        is_active=True,
    )

    earlier = ReportOption(
        kind=ReportOptionKind.TOPIC,
        label="earlier",
        display_order=2,
        is_active=True,
    )

    db.add_all([later, earlier])
    db.flush()

    response = client.get(PORTAL)
    assert response.status_code == 200
    assert [option["id"] for option in response.json()["topics"]] == [
        str(earlier.id),
        str(later.id),
    ]


def test_no_delete_route(db: Session, client: TestClient):
    login(db, client)

    option = ReportOption(
        kind=ReportOptionKind.TOPIC,
        label="Academic stress",
        display_order=0,
        is_active=True,
    )
    db.add(option)
    db.flush()

    response = client.delete(f"{ADMIN}/{option.id}")

    assert response.status_code in (404, 405)
    assert db.get(ReportOption, option.id) is not None


def test_one_report_per_conversation(db: Session):
    account = make_account(db)
    conversation = make_conversation(db)

    outcome = ReportOption(
        kind=ReportOptionKind.OUTCOME,
        label="Felt heard",
        display_order=0,
        is_active=True,
    )
    db.add(outcome)
    db.flush()

    first = ConversationReport(
        conversation_id=conversation.id,
        account_id=account.id,
        outcome_id=outcome.id,
        confidence=4,
        submitted_at=datetime.now(UTC),
    )
    db.add(first)
    db.flush()

    duplicate = ConversationReport(
        conversation_id=conversation.id,
        account_id=account.id,
        outcome_id=outcome.id,
        confidence=3,
        submitted_at=datetime.now(UTC),
    )

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(duplicate)
        db.flush()


def test_database_reject_out_of_bounds_confidence(db: Session):
    account = make_account(db)
    conversation = make_conversation(db)

    outcome = ReportOption(
        kind=ReportOptionKind.OUTCOME,
        label="Felt heard",
        display_order=0,
        is_active=True,
    )
    db.add(outcome)
    db.flush()

    valid = ConversationReport(
        conversation_id=conversation.id,
        account_id=account.id,
        outcome_id=outcome.id,
        confidence=2,
        submitted_at=datetime.now(UTC),
    )
    db.add(valid)
    db.flush()

    conversation2 = make_conversation(db)
    invalid_confidence = ConversationReport(
        conversation_id=conversation2.id,
        account_id=account.id,
        outcome_id=outcome.id,
        confidence=6,
        submitted_at=datetime.now(UTC),
    )

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(invalid_confidence)
        db.flush()
