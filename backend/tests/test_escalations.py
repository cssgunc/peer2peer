import uuid
from datetime import UTC, datetime

import pytest
from cryptography.exceptions import InvalidTag
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountRole,
    AuditLog,
    Channel,
    Conversation,
    ConversationStatus,
    Escalation,
    EscalationStatus,
)
from app.security.encryption import KeyPurpose, decrypt
from app.services.escalations import create_escalation
from app.services.sessions import SESSION_COOKIE_NAME, issue_session
from app.services.shifts import start_shift

ADMIN_URL = "/api/admin/escalations"


def make_account(
    db: Session, display_name: str, role: AccountRole = AccountRole.RESPONDER
) -> Account:
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


def make_responder(db: Session, display_name: str = "Responder") -> Account:
    account = make_account(db, display_name)
    start_shift(db, account, datetime.now(UTC))
    db.flush()
    return account


def make_conversation(db: Session, account: Account | None, label_number: int = 7) -> Conversation:
    now = datetime.now(UTC)
    conversation = Conversation(
        channel=Channel.WEB,
        label_number=label_number,
        status=ConversationStatus.ACTIVE if account else ConversationStatus.QUEUED,
        opened_at=now,
        assigned_account_id=account.id if account else None,
        assigned_at=now if account else None,
    )
    db.add(conversation)
    db.flush()
    return conversation


def sign_in(db: Session, client: TestClient, account: Account) -> None:
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, account, datetime.now(UTC)))
    db.commit()


def escalate(client: TestClient, conversation_id: uuid.UUID):
    return client.post(f"/api/portal/conversations/{conversation_id}/escalate")


def audit_rows(db: Session, action: str) -> list[AuditLog]:
    return list(db.scalars(select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)))


@pytest.fixture
def coordinator(db: Session, client: TestClient) -> Account:
    account = make_account(db, "Coordinator", role=AccountRole.COORDINATOR)
    sign_in(db, client, account)
    return account


@pytest.fixture
def escalation(db: Session) -> Escalation:
    responder = make_responder(db, display_name="Sam Responder")
    escalation = create_escalation(db, make_conversation(db, responder, label_number=4), responder)
    db.commit()
    return escalation


# --- creating -------------------------------------------------------------------------------


def test_assigned_responder_can_escalate(db: Session, client: TestClient) -> None:
    responder = make_responder(db)
    conversation = make_conversation(db, responder)
    sign_in(db, client, responder)

    response = escalate(client, conversation.id)

    assert response.status_code == 201
    escalation = db.get(Escalation, uuid.UUID(response.json()["id"]))
    assert escalation is not None
    assert response.json() == {"id": str(escalation.id)}
    assert escalation.conversation_id == conversation.id
    assert escalation.created_by_account_id == responder.id
    assert escalation.status == EscalationStatus.OPEN
    [entry] = audit_rows(db, "escalation.create")
    assert (entry.actor_account_id, entry.target_type, entry.target_id) == (
        responder.id,
        "escalation",
        escalation.id,
    )


@pytest.mark.parametrize("assignee", ["other", "nobody"])
def test_anyone_but_the_assigned_responder_gets_404(
    db: Session, client: TestClient, assignee: str
) -> None:
    conversation = make_conversation(db, make_responder(db) if assignee == "other" else None)
    sign_in(db, client, make_responder(db))

    response = escalate(client, conversation.id)

    assert response.status_code == 404
    assert db.scalars(select(Escalation)).all() == []
    assert audit_rows(db, "escalation.create") == []


def test_unknown_conversation_gets_404(db: Session, client: TestClient) -> None:
    sign_in(db, client, make_responder(db))

    assert escalate(client, uuid.uuid4()).status_code == 404


def test_escalating_requires_a_shift(db: Session, client: TestClient) -> None:
    responder = make_account(db, "Off shift")
    conversation = make_conversation(db, responder)
    sign_in(db, client, responder)

    response = escalate(client, conversation.id)

    assert response.status_code == 403
    assert response.json()["code"] == "not_on_shift"


def test_escalating_requires_sign_in(db: Session, client: TestClient) -> None:
    conversation = make_conversation(db, make_responder(db))

    assert escalate(client, conversation.id).status_code == 401


# --- the protected payload ------------------------------------------------------------------


def test_payload_is_encrypted_with_the_escalation_key(escalation: Escalation) -> None:
    assert escalation.protected_payload is not None
    assert escalation.key_version is not None
    assert b"source" not in escalation.protected_payload
    assert b"portal" not in escalation.protected_payload
    with pytest.raises(InvalidTag):
        decrypt(escalation.protected_payload, escalation.key_version, KeyPurpose.MESSAGE)
    plaintext = decrypt(escalation.protected_payload, escalation.key_version, KeyPurpose.ESCALATION)
    assert plaintext == '{"source": "portal"}'


# --- coordinator view -----------------------------------------------------------------------


def test_coordinators_can_list_escalations_newest_first(
    db: Session, client: TestClient, coordinator: Account, escalation: Escalation
) -> None:
    responder = make_responder(db, display_name="Alex Responder")
    newer = create_escalation(db, make_conversation(db, responder, label_number=9), responder)
    db.commit()

    response = client.get(ADMIN_URL)

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": str(newer.id),
            "conversation_label": "Texter 9",
            "status": "open",
            "created_by_display_name": "Alex Responder",
            "created_at": newer.created_at.isoformat().replace("+00:00", "Z"),
        },
        {
            "id": str(escalation.id),
            "conversation_label": "Texter 4",
            "status": "open",
            "created_by_display_name": "Sam Responder",
            "created_at": escalation.created_at.isoformat().replace("+00:00", "Z"),
        },
    ]


def test_coordinators_can_read_an_escalation_with_its_payload(
    client: TestClient, coordinator: Account, escalation: Escalation
) -> None:
    response = client.get(f"{ADMIN_URL}/{escalation.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(escalation.id)
    assert body["conversation_label"] == "Texter 4"
    assert body["status"] == "open"
    assert body["created_by_display_name"] == "Sam Responder"
    assert body["payload"] == {"source": "portal"}
    assert response.headers["Cache-Control"] == "no-store"


def test_list_never_includes_the_payload(
    client: TestClient, coordinator: Account, escalation: Escalation
) -> None:
    [item] = client.get(ADMIN_URL).json()

    assert "payload" not in item
    assert "protected_payload" not in item


def test_unknown_escalation_gets_404(client: TestClient, coordinator: Account) -> None:
    assert client.get(f"{ADMIN_URL}/{uuid.uuid4()}").status_code == 404


def test_every_read_adds_an_audit_row(
    db: Session, client: TestClient, coordinator: Account, escalation: Escalation
) -> None:
    assert client.get(ADMIN_URL).status_code == 200
    assert client.get(ADMIN_URL).status_code == 200
    assert client.get(f"{ADMIN_URL}/{escalation.id}").status_code == 200

    rows = audit_rows(db, "escalation.view")
    assert [(r.actor_account_id, r.target_type, r.target_id) for r in rows] == [
        (coordinator.id, "escalation", None),
        (coordinator.id, "escalation", None),
        (coordinator.id, "escalation", escalation.id),
    ]
    assert all(r.details == {} for r in rows)


@pytest.mark.parametrize("detail", [False, True])
def test_responders_get_403_on_admin_routes(
    db: Session, client: TestClient, escalation: Escalation, detail: bool
) -> None:
    sign_in(db, client, make_responder(db))

    response = client.get(f"{ADMIN_URL}/{escalation.id}" if detail else ADMIN_URL)

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"
    assert audit_rows(db, "escalation.view") == []
