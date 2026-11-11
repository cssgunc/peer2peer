import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AccountRole, AuditLog, Faq
from app.models.resource import Resource, ResourceTag
from app.models.statistic import Statistic
from tests.test_sessions import make_account, signed_in


def url(collection: str) -> str:
    return f"/api/admin/{collection}/reorder"


def login(db: Session, client: TestClient, role: AccountRole = AccountRole.COORDINATOR):
    actor = make_account(db, role=role)
    signed_in(db, client, actor, datetime.now(UTC))
    return actor


def make_faqs(db: Session, *specs: tuple[str, int]) -> list[Faq]:
    faqs = [
        Faq(category=category, question=f"Q{order}", answer_md="A", display_order=order)
        for category, order in specs
    ]
    db.add_all(faqs)
    db.flush()
    return faqs


def orders(db: Session, rows: list) -> list[int]:
    for row in rows:
        db.refresh(row)
    return [row.display_order for row in rows]


def test_full_reorder(db: Session, client: TestClient) -> None:
    a, b, c = make_faqs(db, ("Hours", 0), ("Hours", 1), ("Hours", 2))
    actor = login(db, client)
    response = client.put(url("faqs"), json={"ids": [str(c.id), str(a.id), str(b.id)]})
    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body] == [str(c.id), str(a.id), str(b.id)]
    assert [row["display_order"] for row in body] == [0, 1, 2]
    fields = {"id", "category", "question", "answer_md", "display_order", "is_published"}
    assert set(body[0]) == fields
    assert orders(db, [a, b, c]) == [1, 2, 0]
    rows = db.scalars(select(AuditLog)).all()
    assert [(r.action, r.target_type, r.target_id, r.details) for r in rows] == [
        ("faq.reorder", "faq", None, {"count": 3})
    ]
    assert rows[0].actor_account_id == actor.id


def test_subset_reorder_leaves_other_items_alone(db: Session, client: TestClient) -> None:
    a, x, b, y, c = make_faqs(
        db, ("Hours", 0), ("Other", 1), ("Hours", 2), ("Other", 3), ("Hours", 4)
    )
    login(db, client)
    response = client.put(url("faqs"), json={"ids": [str(c.id), str(b.id), str(a.id)]})
    assert response.status_code == 200
    assert [row["display_order"] for row in response.json()] == [0, 2, 4]
    assert orders(db, [a, x, b, y, c]) == [4, 1, 2, 3, 0]


def test_tied_positions_become_strict(db: Session, client: TestClient) -> None:
    tags = [ResourceTag(name=name) for name in ("Alpha", "Beta", "Gamma")]
    db.add_all(tags)
    db.flush()
    login(db, client)
    ids = [str(tags[2].id), str(tags[0].id), str(tags[1].id)]
    response = client.put(url("resource-tags"), json={"ids": ids})
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == ids
    assert orders(db, tags) == [1, 2, 0]


def test_resources_include_tags(db: Session, client: TestClient) -> None:
    tag = ResourceTag(name="Crisis")
    first = Resource(name="One", description="d", url="https://a.example", tags=[tag])
    second = Resource(name="Two", description="d", url="https://b.example", display_order=1)
    db.add_all([first, second])
    db.flush()
    login(db, client)
    response = client.put(url("resources"), json={"ids": [str(second.id), str(first.id)]})
    assert response.status_code == 200
    assert [row["tags"] for row in response.json()] == [
        [],
        [{"id": str(tag.id), "name": "Crisis", "display_order": 0}],
    ]


@pytest.mark.parametrize(
    "ids",
    [
        pytest.param("unknown", id="unknown id"),
        pytest.param("other-collection", id="id from another collection"),
        pytest.param("duplicate", id="duplicate id"),
        pytest.param("empty", id="empty list"),
    ],
)
def test_invalid_ids_give_422(db: Session, client: TestClient, ids: str) -> None:
    (faq,) = make_faqs(db, ("Hours", 0))
    stat = Statistic(label="Chats", value="10", display_order=0)
    db.add(stat)
    db.flush()
    login(db, client)
    payload = {
        "unknown": [str(faq.id), str(uuid.uuid4())],
        "other-collection": [str(faq.id), str(stat.id)],
        "duplicate": [str(faq.id), str(faq.id)],
        "empty": [],
    }[ids]
    response = client.put(url("faqs"), json={"ids": payload})
    assert response.status_code == 422
    assert orders(db, [faq]) == [0]
    assert db.scalars(select(AuditLog)).all() == []


def test_unknown_collection_gives_404(db: Session, client: TestClient) -> None:
    login(db, client)
    response = client.put(url("accounts"), json={"ids": [str(uuid.uuid4())]})
    assert response.status_code == 404


def test_responder_gets_403(db: Session, client: TestClient) -> None:
    (faq,) = make_faqs(db, ("Hours", 0))
    login(db, client, role=AccountRole.RESPONDER)
    response = client.put(url("faqs"), json={"ids": [str(faq.id)]})
    assert response.status_code == 403
