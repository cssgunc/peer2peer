import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, AuditLog, FeedbackSubmission
from app.services.audit import AuditAction, record_audit
from app.services.sessions import SESSION_COOKIE_NAME, issue_session

FEEDBACK_URL = "/api/admin/feedback"
AUDIT_URL = "/api/admin/audit-log"


def make_account(db: Session, role: AccountRole, display_name: str) -> Account:
    account = Account(
        email=f"{uuid.uuid4()}@unc.edu",
        display_name=display_name,
        password_hash="placeholder-not-a-real-password-hash",
        role=role,
        must_change_password=False,
    )
    db.add(account)
    db.flush()
    return account


def sign_in(db: Session, client: TestClient, account: Account) -> None:
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, account, datetime.now(UTC)))
    db.commit()


@pytest.fixture
def coordinator(db: Session, client: TestClient) -> Account:
    account = make_account(db, AccountRole.COORDINATOR, "Casey Coordinator")
    sign_in(db, client, account)
    return account


def add_feedback(
    db: Session, body: str, created_at: datetime, *, read: bool = False
) -> FeedbackSubmission:
    feedback = FeedbackSubmission(
        body=body,
        created_at=created_at,
        read_at=created_at + timedelta(hours=1) if read else None,
    )
    db.add(feedback)
    db.flush()
    return feedback


def test_responders_get_403_on_every_route(db: Session, client: TestClient) -> None:
    feedback = add_feedback(db, "private feedback", datetime(2026, 11, 15, tzinfo=UTC))
    responder = make_account(db, AccountRole.RESPONDER, "Riley Responder")
    sign_in(db, client, responder)

    responses = [
        client.get(FEEDBACK_URL),
        client.patch(f"{FEEDBACK_URL}/{feedback.id}", json={"read": True}),
        client.delete(f"{FEEDBACK_URL}/{feedback.id}"),
        client.get(AUDIT_URL),
    ]

    assert [response.status_code for response in responses] == [403, 403, 403, 403]
    assert db.get(FeedbackSubmission, feedback.id) is not None


def test_feedback_is_newest_first_and_unread_filter_works(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    older = add_feedback(db, "older unread", datetime(2026, 11, 14, tzinfo=UTC))
    read = add_feedback(db, "read", datetime(2026, 11, 15, tzinfo=UTC), read=True)
    newest = add_feedback(db, "newest unread", datetime(2026, 11, 16, tzinfo=UTC))
    db.commit()

    assert [item["id"] for item in client.get(FEEDBACK_URL).json()] == [
        str(newest.id),
        str(read.id),
        str(older.id),
    ]
    unread_items = client.get(FEEDBACK_URL, params={"unread": "true"}).json()
    assert [(item["body"], item["created_on"], item["read"]) for item in unread_items] == [
        ("newest unread", "2026-11-16", False),
        ("older unread", "2026-11-14", False),
    ]
    assert [
        item["body"] for item in client.get(FEEDBACK_URL, params={"unread": "false"}).json()
    ] == ["read"]


def test_feedback_can_be_marked_read_and_then_unread(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    feedback = add_feedback(db, "status changes", datetime(2026, 11, 16, tzinfo=UTC))
    db.commit()

    response = client.patch(f"{FEEDBACK_URL}/{feedback.id}", json={"read": True})
    assert response.status_code == 200
    assert response.json()["read"] is True
    db.refresh(feedback)
    assert feedback.read_at is not None

    response = client.patch(f"{FEEDBACK_URL}/{feedback.id}", json={"read": False})
    assert response.status_code == 200
    assert response.json()["read"] is False
    db.refresh(feedback)
    assert feedback.read_at is None


def test_delete_removes_feedback_and_audits_without_its_text(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    body = "feedback-delete-canary-4f90d1"
    feedback = add_feedback(db, body, datetime(2026, 11, 16, tzinfo=UTC))
    feedback_id = feedback.id
    db.commit()

    response = client.delete(f"{FEEDBACK_URL}/{feedback_id}")

    assert response.status_code == 204
    assert response.content == b""
    assert db.get(FeedbackSubmission, feedback_id) is None
    [entry] = db.scalars(select(AuditLog)).all()
    assert entry.actor_account_id == coordinator.id
    assert entry.action == AuditAction.FEEDBACK_DELETE
    assert entry.target_type == "feedback"
    assert entry.target_id == feedback_id
    assert entry.details == {}
    assert body not in repr(entry.__dict__)


def test_audit_log_pagination_and_filters(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    other_actor = make_account(db, AccountRole.COORDINATOR, "Morgan Coordinator")
    start = datetime(2026, 11, 1, tzinfo=UTC)
    entries: list[AuditLog] = []
    for index in range(55):
        entry = record_audit(
            db,
            actor_id=coordinator.id if index % 2 == 0 else other_actor.id,
            action=(AuditAction.ACCOUNT_UPDATE if index % 3 == 0 else AuditAction.CONTENT_UPDATE),
            target_type="test",
        )
        entry.created_at = start + timedelta(minutes=index)
        entries.append(entry)
    db.commit()

    first_page = client.get(AUDIT_URL).json()
    second_page = client.get(AUDIT_URL, params={"page": 2}).json()
    assert (first_page["page"], first_page["page_size"], first_page["total"]) == (1, 50, 55)
    assert len(first_page["items"]) == 50
    assert [item["id"] for item in first_page["items"][:2]] == [
        entries[54].id,
        entries[53].id,
    ]
    assert (second_page["page"], second_page["page_size"], second_page["total"]) == (
        2,
        50,
        55,
    )
    assert [item["id"] for item in second_page["items"]] == [
        entry.id for entry in reversed(entries[:5])
    ]

    action_page = client.get(AUDIT_URL, params={"action": "account.update"}).json()
    assert action_page["total"] == 19
    assert {item["action"] for item in action_page["items"]} == {"account.update"}

    actor_page = client.get(AUDIT_URL, params={"actor": str(other_actor.id)}).json()
    assert actor_page["total"] == 27
    assert {item["actor_display_name"] for item in actor_page["items"]} == {"Morgan Coordinator"}

    combined = client.get(
        AUDIT_URL,
        params={"action": "account.update", "actor": str(other_actor.id)},
    ).json()
    assert combined["total"] == 9
    assert {item["action"] for item in combined["items"]} == {"account.update"}
    assert {item["actor_display_name"] for item in combined["items"]} == {"Morgan Coordinator"}


def test_audit_log_actor_name_is_null_when_actor_is_unavailable(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    record_audit(
        db,
        actor_id=None,
        action=AuditAction.CONTENT_UPDATE,
        target_type="content",
    )
    db.commit()

    [item] = client.get(AUDIT_URL).json()["items"]

    assert item["actor_display_name"] is None
    assert "metadata" not in item
    assert "details" not in item
