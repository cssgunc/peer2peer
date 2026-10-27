import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccountRole, AuditLog, Statistic
from app.seed import seed_faqs_and_statistics
from tests.test_sessions import make_account, signed_in

PAYLOAD = {"label": "Conversations", "value": "120+"}
PUBLIC = "/api/statistics"
ADMIN = "/api/admin/statistics"


def login(db, client, role=AccountRole.COORDINATOR):
    actor = make_account(db, role=role)
    signed_in(db, client, actor, datetime.now(UTC))
    return actor


def test_visibility_ordering_and_append(db: Session, client: TestClient):
    assert client.get(PUBLIC).json() == []
    login(db, client)
    first = client.post(ADMIN, json={**PAYLOAD, "display_order": 8, "is_published": True})
    assert first.status_code == 201
    draft = client.post(ADMIN, json=PAYLOAD).json()
    assert draft["display_order"] == 9
    early = client.post(ADMIN, json={**PAYLOAD, "display_order": -1, "is_published": True}).json()
    public = client.get(PUBLIC).json()
    assert [row["id"] for row in public] == [early["id"], first.json()["id"]]
    assert all(set(row) == {"id", *PAYLOAD} for row in public)
    assert [row["id"] for row in client.get(ADMIN).json()] == [
        early["id"],
        first.json()["id"],
        draft["id"],
    ]


def test_patch_delete_and_audit(db: Session, client: TestClient):
    actor = login(db, client)
    original = client.post(ADMIN, json=PAYLOAD).json()
    path = ADMIN + "/" + original["id"]
    changed = client.patch(path, json={"value": "Updated"})
    assert changed.status_code == 200
    assert changed.json() == {**original, "value": "Updated"}
    assert client.patch(path, json={"is_published": True}).status_code == 200
    assert len(client.get(PUBLIC).json()) == 1
    assert client.delete(path).status_code == 204
    assert client.get(PUBLIC).json() == []
    assert client.get(ADMIN).json() == []
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    assert [r.action for r in rows] == [
        "statistic.create",
        "statistic.update",
        "statistic.update",
        "statistic.delete",
    ]
    assert all(
        r.actor_account_id == actor.id
        and str(r.target_id) == original["id"]
        and r.target_type == "statistic"
        for r in rows
    )
    assert rows[1].details == {"fields": ["value"]}
    assert rows[0].details == rows[-1].details == {}


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_unknown_id(db: Session, client: TestClient, method):
    login(db, client)
    kwargs = {"json": {"value": "Changed"}} if method == "patch" else {}
    response = getattr(client, method)(ADMIN + "/" + str(uuid.uuid4()), **kwargs)
    assert response.status_code == 404
    assert db.scalars(select(AuditLog)).all() == []


@pytest.mark.parametrize("role,status", [(None, 401), (AccountRole.RESPONDER, 403)])
def test_admin_access(db: Session, client: TestClient, role, status):
    if role is not None:
        login(db, client, role)
    path = ADMIN + "/" + str(uuid.uuid4())
    assert client.get(ADMIN).status_code == status
    assert client.post(ADMIN, json=PAYLOAD).status_code == status
    assert client.patch(path, json={}).status_code == status
    assert client.delete(path).status_code == status
    assert db.scalars(select(Statistic)).all() == []
    assert db.scalars(select(AuditLog)).all() == []


def test_validation(db: Session, client: TestClient):
    login(db, client)
    assert client.post(ADMIN, json={**PAYLOAD, "value": ""}).status_code == 422
    row = client.post(ADMIN, json=PAYLOAD).json()
    for field in [*PAYLOAD, "display_order", "is_published"]:
        assert client.patch(ADMIN + "/" + row["id"], json={field: None}).status_code == 422
    assert client.patch(ADMIN + "/" + row["id"], json={}).json() == row


def test_seed_is_idempotent_and_preserves_edits(db: Session):
    seed_faqs_and_statistics(db)
    rows = db.scalars(select(Statistic).order_by(Statistic.display_order)).all()
    assert len(rows) == 3
    assert sum(row.is_published for row in rows) == 2
    rows[0].is_published = False
    db.flush()
    seed_faqs_and_statistics(db)
    assert len(db.scalars(select(Statistic)).all()) == len(rows)
    assert not rows[0].is_published
