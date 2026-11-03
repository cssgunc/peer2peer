import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccountRole, AuditLog
from app.models.fit_guide import Fit, FitGuideItem
from tests.test_faqs import login

RESOURCES = "/api/admin/resources"
TAGS = "/api/admin/resource-tags"
PAYLOAD = {"name": "Support", "description": "Peer support", "url": "https://example.org"}


def test_resource_lifecycle_tags_fit_guide_and_audit(db: Session, client: TestClient):
    actor = login(db, client)
    first = client.post(TAGS, json={"name": "First", "display_order": 2}).json()
    second = client.post(TAGS, json={"name": "Second"}).json()
    created = client.post(RESOURCES, json={**PAYLOAD, "tag_ids": [first["id"]]})
    assert created.status_code == 201
    resource = created.json()
    assert resource["tags"] == [first]
    assert resource["is_published"] is False
    assert resource["display_order"] == 0
    assert client.get(RESOURCES).json() == [resource]
    assert client.get("/api/resources").json() == []
    path = RESOURCES + "/" + resource["id"]
    changed = client.patch(path, json={"tag_ids": [second["id"]], "is_published": True})
    assert changed.status_code == 200
    assert changed.json()["tags"] == [second]
    assert len(client.get("/api/resources").json()) == 1
    renamed = client.patch(TAGS + "/" + second["id"], json={"name": "Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["display_order"] == 0
    assert client.delete(TAGS + "/" + second["id"]).status_code == 204
    assert client.get(RESOURCES).json()[0]["tags"] == []
    guide = FitGuideItem(
        fit=Fit.OTHER_RESOURCE,
        text="Try support",
        resource_id=uuid.UUID(resource["id"]),
        display_order=0,
    )
    db.add(guide)
    db.commit()
    assert client.delete(path).status_code == 204
    db.refresh(guide)
    assert guide.resource_id is None
    assert client.get(RESOURCES).json() == []
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    assert [row.action for row in rows] == [
        "resource_tag.create",
        "resource_tag.create",
        "resource.create",
        "resource.update",
        "resource_tag.update",
        "resource_tag.delete",
        "resource.delete",
    ]
    assert all(row.actor_account_id == actor.id for row in rows)
    assert rows[2].target_type == "resource"
    assert str(rows[2].target_id) == resource["id"]
    assert rows[3].details == {"fields": ["is_published", "tag_ids"]}
    assert rows[4].target_type == "resource_tag"
    assert str(rows[4].target_id) == second["id"]
    assert rows[4].details == {"fields": ["name"]}
    assert rows[-1].details == {}


def test_duplicate_tags(db: Session, client: TestClient):
    login(db, client)
    first = client.post(TAGS, json={"name": "Same"}).json()
    second = client.post(TAGS, json={"name": "Different"}).json()
    for response in [
        client.post(TAGS, json={"name": "Same"}),
        client.patch(TAGS + "/" + second["id"], json={"name": "Same"}),
    ]:
        assert response.status_code == 409
        assert response.json()["code"] == "tag_exists"
    assert client.patch(TAGS + "/" + first["id"], json={"name": "Same"}).status_code == 200
    assert len(client.get(TAGS).json()) == 2
    assert len(db.scalars(select(AuditLog)).all()) == 3


@pytest.mark.parametrize(
    "payload",
    [
        {"url": None},
        {"url": "ftp://example.org"},
        {"url": "javascript:alert(1)"},
        {"url": None, "phone": "  "},
        {"name": ""},
        {"tag_ids": [str(uuid.uuid4())]},
    ],
)
def test_resource_validation(db: Session, client: TestClient, payload):
    login(db, client)
    assert client.post(RESOURCES, json={**PAYLOAD, **payload}).status_code == 422
    assert db.scalars(select(AuditLog)).all() == []


def test_partial_update_validation_and_tag_clearing(db: Session, client: TestClient):
    login(db, client)
    tag = client.post(TAGS, json={"name": "Tag"}).json()
    resource = client.post(RESOURCES, json={**PAYLOAD, "tag_ids": [tag["id"], tag["id"]]}).json()
    path = RESOURCES + "/" + resource["id"]
    for payload in [
        {"url": None},
        {"phone": ""},
        {"name": None},
        {"tag_ids": None},
        {"tag_ids": [str(uuid.uuid4())]},
    ]:
        assert client.patch(path, json=payload).status_code == 422
        assert client.get(RESOURCES).json() == [resource]
    assert client.patch(path, json={}).json() == resource
    changed = client.patch(path, json={"url": None, "phone": "123", "tag_ids": []})
    assert changed.status_code == 200
    assert changed.json()["url"] is None
    assert changed.json()["tags"] == []
    assert client.patch(path, json={"phone": None}).status_code == 422


@pytest.mark.parametrize("endpoint,payload", [(RESOURCES, PAYLOAD), (TAGS, {"name": "Tag"})])
@pytest.mark.parametrize("role,status", [(None, 401), (AccountRole.RESPONDER, 403)])
def test_access(db: Session, client: TestClient, endpoint, payload, role, status):
    if role:
        login(db, client, role)
    path = endpoint + "/" + str(uuid.uuid4())
    assert client.get(endpoint).status_code == status
    assert client.post(endpoint, json=payload).status_code == status
    assert client.patch(path, json={}).status_code == status
    assert client.delete(path).status_code == status
    assert db.scalars(select(AuditLog)).all() == []


@pytest.mark.parametrize("endpoint", [RESOURCES, TAGS])
def test_missing_item(db: Session, client: TestClient, endpoint):
    login(db, client)
    path = endpoint + "/" + str(uuid.uuid4())
    assert client.patch(path, json={}).status_code == 404
    assert client.delete(path).status_code == 404
    assert db.scalars(select(AuditLog)).all() == []


def test_tag_validation(db: Session, client: TestClient):
    login(db, client)
    assert client.post(TAGS, json={"name": " "}).status_code == 422
    tag = client.post(TAGS, json={"name": "Tag"}).json()
    for payload in [{"name": None}, {"name": ""}, {"display_order": None}]:
        assert client.patch(TAGS + "/" + tag["id"], json=payload).status_code == 422


def test_ordering_and_tag_deletion_across_resources(db: Session, client: TestClient):
    login(db, client)
    late = client.post(TAGS, json={"name": "Late", "display_order": 8}).json()
    early = client.post(TAGS, json={"name": "Early", "display_order": -1}).json()
    assert client.get(TAGS).json() == [early, late]
    last = client.post(
        RESOURCES,
        json={**PAYLOAD, "display_order": 8, "tag_ids": [late["id"], early["id"]]},
    ).json()
    first = client.post(
        RESOURCES, json={**PAYLOAD, "display_order": -1, "tag_ids": [early["id"]]}
    ).json()
    assert last["tags"] == [early, late]
    assert client.get(RESOURCES).json() == [first, last]
    assert client.delete(TAGS + "/" + early["id"]).status_code == 204
    remaining = client.get(RESOURCES).json()
    assert remaining[0]["tags"] == []
    assert remaining[1]["tags"] == [late]
