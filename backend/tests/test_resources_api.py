from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Resource, ResourceTag, ResourceTagLink


def make_tags(db: Session) -> dict[str, ResourceTag]:
    # Tests build tables with create_all, so the migration's starting tags don't exist here.
    tags = {
        name: ResourceTag(name=name, display_order=order)
        for order, name in enumerate(["Crisis/Urgent", "Ongoing Care", "Peer & Community"])
    }
    db.add_all(tags.values())
    db.flush()
    return tags


def make_resource(db: Session, name: str, **fields: object) -> Resource:
    fields = {"description": f"About {name}", "is_published": True, **fields}
    resource = Resource(name=name, **fields)
    db.add(resource)
    db.flush()
    return resource


def names(response_json: list[dict]) -> list[str]:
    return [resource["name"] for resource in response_json]


def test_unpublished_resources_are_hidden(client: TestClient, db: Session) -> None:
    make_resource(db, "Published")
    make_resource(db, "Draft", is_published=False)

    response = client.get("/api/resources")

    assert response.status_code == 200
    assert names(response.json()) == ["Published"]


def test_tag_filter(client: TestClient, db: Session) -> None:
    tags = make_tags(db)
    make_resource(db, "Crisis", tags=[tags["Crisis/Urgent"]])
    make_resource(db, "Ongoing", tags=[tags["Ongoing Care"]])

    response = client.get("/api/resources", params={"tag": "Crisis/Urgent"})

    assert names(response.json()) == ["Crisis"]


def test_unc_filter(client: TestClient, db: Session) -> None:
    make_resource(db, "UNC", is_unc=True)
    make_resource(db, "National", is_unc=False)

    assert names(client.get("/api/resources", params={"unc": "true"}).json()) == ["UNC"]
    assert names(client.get("/api/resources", params={"unc": "false"}).json()) == ["National"]


def test_ordered_by_display_order_then_name(client: TestClient, db: Session) -> None:
    make_resource(db, "Last", display_order=2)
    make_resource(db, "Bravo", display_order=1)
    make_resource(db, "Alpha", display_order=1)

    assert names(client.get("/api/resources").json()) == ["Alpha", "Bravo", "Last"]


def test_tags_come_back_in_tag_order(client: TestClient, db: Session) -> None:
    tags = make_tags(db)
    make_resource(
        db,
        "Tagged",
        tags=[tags["Peer & Community"], tags["Crisis/Urgent"], tags["Ongoing Care"]],
    )

    [resource] = client.get("/api/resources").json()
    assert resource["tags"] == ["Crisis/Urgent", "Ongoing Care", "Peer & Community"]

    response = client.get("/api/resource-tags")
    assert [tag["name"] for tag in response.json()] == list(tags)
    assert response.json()[0] == {"id": str(tags["Crisis/Urgent"].id), "name": "Crisis/Urgent"}


def test_deleting_a_tag_removes_its_links(db: Session) -> None:
    tags = make_tags(db)
    resource = make_resource(db, "Tagged", tags=[tags["Crisis/Urgent"], tags["Ongoing Care"]])

    db.delete(tags["Crisis/Urgent"])
    db.flush()
    db.expire_all()

    links = db.scalars(select(ResourceTagLink.tag_id)).all()
    assert links == [tags["Ongoing Care"].id]
    assert [tag.name for tag in resource.tags] == ["Ongoing Care"]
    assert db.scalar(select(func.count()).select_from(Resource)) == 1
