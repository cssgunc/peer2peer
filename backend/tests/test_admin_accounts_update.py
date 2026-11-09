import logging
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import events
from app.dependencies.auth import require_coordinator
from app.events import SESSION_REVOKED, SHIFT_ENDED, Event, portal_topic
from app.main import app
from app.models import (
    Account,
    AccountRole,
    AuditLog,
    AuthSession,
    Channel,
    Conversation,
    ConversationStatus,
    Shift,
)
from app.models.shift import ShiftEndReason
from app.security.passwords import verify_password
from app.services.sessions import SESSION_COOKIE_NAME, issue_session
from app.services.shifts import start_shift

URL = "/api/admin/accounts"
ME = "/api/auth/me"


def make_account(
    db: Session,
    email: str,
    display_name: str = "Test staff",
    role: AccountRole = AccountRole.RESPONDER,
    is_active: bool = True,
) -> Account:
    account = Account(
        email=email,
        display_name=display_name,
        password_hash="placeholder-not-a-real-password-hash",
        role=role,
        is_active=is_active,
        must_change_password=False,
    )
    db.add(account)
    db.flush()
    return account


def token_for(db: Session, account: Account) -> str:
    token = issue_session(db, account, datetime.now(UTC))
    db.commit()
    return token


@pytest.fixture
def coordinator(db: Session, client: TestClient) -> Account:
    account = make_account(
        db, "coordinator@unc.edu", display_name="Coordinator", role=AccountRole.COORDINATOR
    )
    client.cookies.set(SESSION_COOKIE_NAME, token_for(db, account))
    return account


@pytest.fixture
def responder(db: Session) -> Account:
    account = make_account(db, "responder@unc.edu", display_name="Responder")
    db.commit()
    return account


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Event]]:
    sent: list[tuple[str, Event]] = []
    monkeypatch.setattr(events.event_bus, "publish", lambda topic, e: sent.append((topic, e)))
    return sent


def patch(client: TestClient, account: Account, **body: object):
    return client.patch(f"{URL}/{account.id}", json=body)


def audit_actions(db: Session) -> list[str]:
    return list(db.scalars(select(AuditLog.action).order_by(AuditLog.created_at, AuditLog.id)))


# --- access ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [("PATCH", "", {"display_name": "New"}), ("POST", "/reset-password", None)],
)
def test_responders_get_403(
    db: Session,
    client: TestClient,
    responder: Account,
    method: str,
    suffix: str,
    body: dict | None,
) -> None:
    other = make_account(db, "other@unc.edu", display_name="Other")
    client.cookies.set(SESSION_COOKIE_NAME, token_for(db, responder))

    response = client.request(method, f"{URL}/{other.id}{suffix}", json=body)

    assert response.status_code == 403
    db.refresh(other)
    assert other.display_name == "Other"
    assert audit_actions(db) == []


def test_unknown_account_gives_404(client: TestClient, coordinator: Account) -> None:
    missing = "00000000-0000-0000-0000-000000000000"

    assert client.patch(f"{URL}/{missing}", json={"display_name": "X"}).status_code == 404
    assert client.post(f"{URL}/{missing}/reset-password").status_code == 404


# --- update ---------------------------------------------------------------------------------


def test_rename_and_change_role(
    db: Session, client: TestClient, coordinator: Account, responder: Account
) -> None:
    response = patch(client, responder, display_name="  Renamed  ", role="coordinator")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display_name"] == "Renamed"
    assert body["role"] == "coordinator"
    assert body["is_active"] is True
    db.refresh(responder)
    assert responder.display_name == "Renamed"
    assert responder.role == AccountRole.COORDINATOR

    [entry] = db.scalars(select(AuditLog))
    assert entry.action == "account.update"
    assert entry.actor_account_id == coordinator.id
    assert entry.target_id == responder.id
    assert entry.details == {"fields": ["display_name", "role"]}


def test_unchanged_fields_are_not_audited(
    db: Session, client: TestClient, coordinator: Account, responder: Account
) -> None:
    response = patch(client, responder, display_name="Responder", role="responder")

    assert response.status_code == 200
    assert audit_actions(db) == []


@pytest.mark.parametrize(
    "body",
    [{"display_name": "   "}, {"display_name": "x" * 101}, {"role": "admin"}],
    ids=["blank-name", "long-name", "unknown-role"],
)
def test_invalid_update_gives_422(
    client: TestClient, coordinator: Account, responder: Account, body: dict
) -> None:
    response = patch(client, responder, **body)

    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_deactivate_revokes_sessions_ends_shift_and_requeues(
    db: Session,
    client: TestClient,
    coordinator: Account,
    responder: Account,
    published: list[tuple[str, Event]],
) -> None:
    now = datetime.now(UTC)
    responder_token = token_for(db, responder)
    shift = start_shift(db, responder, now)
    active = Conversation(
        channel=Channel.WEB,
        opened_at=now,
        status=ConversationStatus.ACTIVE,
        assigned_account_id=responder.id,
        assigned_at=now,
    )
    closed = Conversation(
        channel=Channel.WEB,
        opened_at=now,
        closed_at=now,
        status=ConversationStatus.CLOSED,
        assigned_account_id=responder.id,
        assigned_at=now,
    )
    db.add_all([active, closed])
    db.commit()
    coordinator_token = client.cookies[SESSION_COOKIE_NAME]

    # The responder's cookie works before deactivation.
    client.cookies.set(SESSION_COOKIE_NAME, responder_token)
    assert client.get(ME).status_code == 200
    client.cookies.set(SESSION_COOKIE_NAME, coordinator_token)

    response = patch(client, responder, is_active=False)

    assert response.status_code == 200, response.text
    assert response.json()["is_active"] is False
    assert response.json()["on_shift"] is False

    db.refresh(shift)
    assert shift.ended_at is not None
    assert shift.ended_reason == ShiftEndReason.DEACTIVATED
    db.refresh(active)
    assert active.status == ConversationStatus.QUEUED
    assert active.assigned_account_id is None
    db.refresh(closed)
    assert closed.assigned_account_id == responder.id  # still awaiting its report
    assert (
        db.scalar(
            select(func.count())
            .select_from(AuthSession)
            .where(AuthSession.account_id == responder.id, AuthSession.revoked_at.is_(None))
        )
        == 0
    )

    types = [e["type"] for topic, e in published if topic == portal_topic(responder.id)]
    assert SESSION_REVOKED in types
    assert SHIFT_ENDED in types
    assert audit_actions(db) == ["account.deactivate"]

    # The old cookie no longer works.
    client.cookies.set(SESSION_COOKIE_NAME, responder_token)
    assert client.get(ME).status_code == 401


def test_deactivate_with_a_rename_audits_both(
    db: Session, client: TestClient, coordinator: Account, responder: Account
) -> None:
    response = patch(client, responder, display_name="Gone", is_active=False)

    assert response.status_code == 200
    entries = {e.action: e.details for e in db.scalars(select(AuditLog))}
    assert entries == {
        "account.update": {"fields": ["display_name"]},
        "account.deactivate": {},
    }


def test_reactivate_only_sets_the_flag(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    gone = make_account(db, "gone@unc.edu", is_active=False)
    db.commit()

    response = patch(client, gone, is_active=True)

    assert response.status_code == 200
    db.refresh(gone)
    assert gone.is_active is True
    assert db.scalar(select(func.count()).select_from(Shift)) == 0
    assert (
        db.scalar(
            select(func.count()).select_from(AuthSession).where(AuthSession.account_id == gone.id)
        )
        == 0
    )
    [entry] = db.scalars(select(AuditLog))
    assert (entry.action, entry.details) == ("account.update", {"fields": ["is_active"]})


# --- guards ---------------------------------------------------------------------------------


@pytest.mark.parametrize("body", [{"is_active": False}, {"role": "responder"}])
def test_coordinator_cannot_deactivate_or_demote_themselves(
    db: Session, client: TestClient, coordinator: Account, body: dict
) -> None:
    # Another coordinator exists, so only the self guard applies.
    make_account(db, "other@unc.edu", role=AccountRole.COORDINATOR)
    db.commit()

    response = patch(client, coordinator, **body)

    assert response.status_code == 422
    assert response.json()["code"] == "cannot_change_own_access"
    assert response.json()["detail"]
    db.refresh(coordinator)
    assert coordinator.is_active is True
    assert coordinator.role == AccountRole.COORDINATOR
    assert audit_actions(db) == []


def test_coordinator_can_still_rename_themselves(client: TestClient, coordinator: Account) -> None:
    response = patch(client, coordinator, display_name="New name", role="coordinator")

    assert response.status_code == 200
    assert response.json()["display_name"] == "New name"


@pytest.mark.parametrize("body", [{"is_active": False}, {"role": "responder"}])
def test_last_active_coordinator_cannot_be_deactivated_or_demoted(
    db: Session, client: TestClient, body: dict
) -> None:
    # Two coordinators demote each other at once: by the time the second request runs, the
    # first has committed, so the second caller already passed require_coordinator but the
    # target is now the last active coordinator. Model that by authorizing a stale caller.
    target = make_account(db, "last@unc.edu", role=AccountRole.COORDINATOR)
    stale_caller = make_account(db, "demoted@unc.edu", role=AccountRole.RESPONDER)
    make_account(db, "former@unc.edu", role=AccountRole.COORDINATOR, is_active=False)
    db.commit()
    app.dependency_overrides[require_coordinator] = lambda: stale_caller

    response = patch(client, target, **body)

    assert response.status_code == 422
    assert response.json()["code"] == "last_coordinator"
    assert response.json()["detail"]
    db.refresh(target)
    assert target.is_active is True
    assert target.role == AccountRole.COORDINATOR
    assert audit_actions(db) == []


def test_coordinators_can_be_demoted_and_deactivated_while_another_remains(
    db: Session, client: TestClient, coordinator: Account
) -> None:
    other = make_account(db, "other@unc.edu", role=AccountRole.COORDINATOR)
    third = make_account(db, "third@unc.edu", role=AccountRole.COORDINATOR)
    db.commit()

    assert patch(client, other, role="responder").status_code == 200
    assert patch(client, third, is_active=False).status_code == 200
    # Renaming the last coordinator is still fine, and an inactive one can be demoted.
    assert patch(client, coordinator, display_name="Still here").status_code == 200
    assert patch(client, third, role="responder").status_code == 200


# --- reset password -------------------------------------------------------------------------


def test_reset_password_sets_a_new_temporary_password_and_ends_sessions(
    db: Session, client: TestClient, coordinator: Account, responder: Account
) -> None:
    responder_token = token_for(db, responder)
    old_hash = responder.password_hash

    response = client.post(f"{URL}/{responder.id}/reset-password")

    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    body = response.json()
    assert list(body) == ["temporary_password"]
    password = body["temporary_password"]
    db.refresh(responder)
    assert responder.password_hash != old_hash
    assert verify_password(password, responder.password_hash)
    assert responder.must_change_password is True
    assert responder.is_active is True

    client.cookies.set(SESSION_COOKIE_NAME, responder_token)
    assert client.get(ME).status_code == 401

    [entry] = db.scalars(select(AuditLog))
    assert entry.action == "account.reset_password"
    assert entry.target_id == responder.id
    assert entry.details == {}


def test_temporary_password_never_reaches_logs_or_audit_rows(
    db: Session,
    client: TestClient,
    coordinator: Account,
    responder: Account,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with caplog.at_level(logging.DEBUG), caplog.at_level(logging.DEBUG, logger="app"):
        response = client.post(f"{URL}/{responder.id}/reset-password")
    password = response.json()["temporary_password"]

    captured = capsys.readouterr()
    for output in (caplog.text, captured.out, captured.err):
        assert password not in output
    for entry in db.scalars(select(AuditLog)):
        assert password not in str(entry.details)
