import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, AuditLog, Fit, FitGuideItem, Resource, ResourceTag
from app.seed import seed_fit_guide
from tests.test_sessions import make_account, signed_in

PUBLIC = "/api/fit-guide"
ADMIN = "/api/admin/fit-guide"
PAYLOAD = {"fit": "good_fit", "text": "You want someone to listen.", "display_order": 0}


def login(db: Session, client: TestClient, role: AccountRole = AccountRole.COORDINATOR) -> Account:
    actor = make_account(db, role=role)
    signed_in(db, client, actor, datetime.now(UTC))
    return actor


def make_resource(db: Session, published: bool = True) -> Resource:
    resource = Resource(
        name="Sample resource",
        description="Sample description",
        url="https://example.com/resource",
        phone=None,
        is_published=published,
    )
    db.add(resource)
    db.flush()
    return resource


def make_item(
    db: Session,
    fit: Fit = Fit.GOOD_FIT,
    order: int = 0,
    resource: Resource | None = None,
) -> FitGuideItem:
    item = FitGuideItem(
        fit=fit,
        text=f"Sample {fit.value} item at {order}",
        resource_id=resource.id if resource else None,
        display_order=order,
    )
    db.add(item)
    db.flush()
    return item


def test_public_empty_and_grouped_ordering(db: Session, client: TestClient) -> None:
    response = client.get(PUBLIC)
    assert response.status_code == 200
    assert response.json() == {"good_fit": [], "other_resource": []}

    good_last = make_item(db, order=8)
    other_last = make_item(db, Fit.OTHER_RESOURCE, 7)
    good_first = make_item(db, order=-1)
    other_first = make_item(db, Fit.OTHER_RESOURCE, -2)
    good_tie = make_item(db, order=-1)
    response = client.get(PUBLIC)
    assert response.status_code == 200
    guide = response.json()
    assert [row["id"] for row in guide["good_fit"]] == [
        str(item.id) for item in [good_first, good_tie, good_last]
    ]
    assert [row["id"] for row in guide["other_resource"]] == [
        str(other_first.id),
        str(other_last.id),
    ]
    assert guide["good_fit"][0] == {
        "id": str(good_first.id),
        "text": good_first.text,
        "resource_id": None,
        "resource": None,
    }


@pytest.mark.parametrize("published", [True, False])
def test_public_includes_only_published_resource(
    db: Session, client: TestClient, published: bool
) -> None:
    resource = make_resource(db, published)
    item = make_item(db, Fit.OTHER_RESOURCE, resource=resource)
    response = client.get(PUBLIC)
    assert response.status_code == 200
    [row] = response.json()["other_resource"]
    assert row["id"] == str(item.id)
    assert row["resource_id"] == str(resource.id)
    assert row["resource"] == (
        {"id": str(resource.id), "name": resource.name, "url": resource.url, "phone": None}
        if published
        else None
    )

    resource.is_published = not published
    db.flush()
    linked = client.get(PUBLIC).json()["other_resource"][0]["resource"]
    assert (linked is not None) == (not published)


def test_deleting_resource_preserves_item_without_link(db: Session, client: TestClient) -> None:
    resource = make_resource(db)
    item = make_item(db, Fit.OTHER_RESOURCE, resource=resource)
    db.delete(resource)
    db.flush()
    db.expire_all()

    assert db.get(FitGuideItem, item.id) is item
    assert item.resource_id is None
    assert client.get(PUBLIC).json()["other_resource"] == [
        {"id": str(item.id), "text": item.text, "resource_id": None, "resource": None}
    ]


def test_admin_crud_and_audit(db: Session, client: TestClient) -> None:
    actor = login(db, client)
    assert client.get(ADMIN).json() == []
    response = client.post(ADMIN, json=PAYLOAD)
    assert response.status_code == 201
    original = response.json()
    assert original == {**PAYLOAD, "id": original["id"], "resource_id": None}
    path = f"{ADMIN}/{original['id']}"
    # Coordinators can link a draft; the public response still hides its details.
    resource = make_resource(db, published=False)
    changes = {
        "fit": "other_resource",
        "text": "You need another kind of support.",
        "display_order": 5,
        "resource_id": str(resource.id),
    }
    response = client.patch(path, json=changes)
    assert response.status_code == 200
    assert response.json() == {**original, **changes}
    assert client.get(ADMIN).json() == [response.json()]
    guide = client.get(PUBLIC).json()
    assert guide["good_fit"] == []
    assert guide["other_resource"][0]["resource"] is None
    response = client.delete(path)
    assert response.status_code == 204
    assert response.content == b""
    assert client.get(ADMIN).json() == []
    assert client.get(PUBLIC).json() == {"good_fit": [], "other_resource": []}

    audit = db.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    assert [row.action for row in audit] == [
        "fit_guide.create",
        "fit_guide.update",
        "fit_guide.delete",
    ]
    assert all(
        row.actor_account_id == actor.id
        and str(row.target_id) == original["id"]
        and row.target_type == "fit_guide"
        for row in audit
    )
    assert audit[0].details == audit[2].details == {}
    assert audit[1].details == {"fields": sorted(changes)}


def test_admin_list_order(db: Session, client: TestClient) -> None:
    login(db, client)
    last = make_item(db, order=10)
    first = make_item(db, Fit.OTHER_RESOURCE, -1)
    tie = make_item(db, order=-1)
    response = client.get(ADMIN)
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(item.id) for item in [first, tie, last]]


def test_patch_omitted_resource_and_explicit_null(db: Session, client: TestClient) -> None:
    login(db, client)
    resource = make_resource(db)
    response = client.post(ADMIN, json={**PAYLOAD, "resource_id": str(resource.id)})
    assert response.status_code == 201
    original = response.json()
    path = f"{ADMIN}/{original['id']}"

    assert client.patch(path, json={}).json() == original
    changed = client.patch(path, json={"text": "Edited"})
    assert changed.status_code == 200
    assert changed.json()["resource_id"] == str(resource.id)
    cleared = client.patch(path, json={"resource_id": None})
    assert cleared.status_code == 200
    assert cleared.json()["resource_id"] is None
    assert client.get(PUBLIC).json()["good_fit"][0]["resource"] is None


@pytest.mark.parametrize("method", ["post", "patch"])
def test_unknown_resource_returns_422_without_writes(
    db: Session, client: TestClient, method: str
) -> None:
    login(db, client)
    item = make_item(db)
    path = ADMIN if method == "post" else f"{ADMIN}/{item.id}"
    response = getattr(client, method)(
        path, json={**PAYLOAD, "resource_id": str(uuid.uuid4()), "text": "Must not persist"}
    )
    assert response.status_code == 422
    db.refresh(item)
    assert item.text != "Must not persist"
    assert item.resource_id is None
    assert db.scalars(select(FitGuideItem)).all() == [item]
    assert db.scalars(select(AuditLog)).all() == []


@pytest.mark.parametrize("method", ["patch", "delete"])
def test_unknown_item_returns_404(db: Session, client: TestClient, method: str) -> None:
    login(db, client)
    kwargs = {"json": {"text": "Edited"}} if method == "patch" else {}
    response = getattr(client, method)(f"{ADMIN}/{uuid.uuid4()}", **kwargs)
    assert response.status_code == 404
    assert db.scalars(select(AuditLog)).all() == []


@pytest.mark.parametrize("role,status", [(None, 401), (AccountRole.RESPONDER, 403)])
def test_admin_access(
    db: Session, client: TestClient, role: AccountRole | None, status: int
) -> None:
    if role is not None:
        login(db, client, role)
    item = make_item(db)
    path = f"{ADMIN}/{item.id}"
    assert client.get(ADMIN).status_code == status
    assert client.post(ADMIN, json=PAYLOAD).status_code == status
    assert client.patch(path, json={"text": "Unauthorized edit"}).status_code == status
    assert client.delete(path).status_code == status
    db.refresh(item)
    assert item.text != "Unauthorized edit"
    assert db.scalars(select(FitGuideItem)).all() == [item]
    assert db.scalars(select(AuditLog)).all() == []


@pytest.mark.parametrize("method", ["post", "patch"])
@pytest.mark.parametrize(
    "invalid",
    [
        {"fit": "unknown"},
        {"fit": None},
        {"text": ""},
        {"text": "x" * 301},
        {"text": None},
        {"display_order": None},
        {"display_order": "first"},
        {"resource_id": "invalid-uuid"},
        {"unexpected": "field"},
    ],
)
def test_validation(db: Session, client: TestClient, method: str, invalid: dict) -> None:
    login(db, client)
    item = make_item(db)
    path = ADMIN if method == "post" else f"{ADMIN}/{item.id}"
    payload = {**PAYLOAD, **invalid} if method == "post" else invalid
    assert getattr(client, method)(path, json=payload).status_code == 422
    assert db.scalars(select(AuditLog)).all() == []


@pytest.mark.parametrize("field", ["fit", "text", "display_order"])
def test_create_requires_fields(db: Session, client: TestClient, field: str) -> None:
    login(db, client)
    payload = {name: value for name, value in PAYLOAD.items() if name != field}
    assert client.post(ADMIN, json=payload).status_code == 422


def test_seed_is_idempotent_and_links_resources(db: Session, client: TestClient) -> None:
    # The test schema uses metadata; production's resource migration inserts these tags.
    db.add_all(
        ResourceTag(name=name, display_order=order)
        for order, name in enumerate(
            ["Crisis/Urgent", "Ongoing Care", "Peer & Community", "Training"]
        )
    )
    db.flush()
    seed_fit_guide(db)
    rows = db.scalars(
        select(FitGuideItem).order_by(FitGuideItem.display_order, FitGuideItem.id)
    ).all()
    assert len(rows) == 8
    assert sum(row.fit == Fit.GOOD_FIT for row in rows) == 4
    assert sum(row.fit == Fit.OTHER_RESOURCE for row in rows) == 4
    assert sum(row.resource_id is not None for row in rows) == 2
    rows[0].display_order = 20
    db.flush()
    seed_fit_guide(db)
    assert len(db.scalars(select(FitGuideItem)).all()) == 8
    assert rows[0].display_order == 20
    guide = client.get(PUBLIC).json()
    assert sum(row["resource"] is not None for row in guide["other_resource"]) == 2
