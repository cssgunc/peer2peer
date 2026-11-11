from datetime import UTC, datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountRole, AuditLog
from app.models.hours import HoursException
from app.services.sessions import SESSION_COOKIE_NAME, issue_session

URL = "/api/admin/hours"
WINDOW = {"day_of_week": 0, "opens_at": "19:00:00", "closes_at": "23:00:00"}


def today():
    return datetime.now(ZoneInfo("America/New_York")).date()


def exception():
    return {"date": today().isoformat(), "is_closed": True, "note": "Break"}


def sign_in(db, client, role):
    account = Account(
        email="staff@unc.edu",
        display_name="Staff",
        password_hash="test",
        role=role,
        must_change_password=False,
    )
    db.add(account)
    db.flush()
    client.cookies.set(SESSION_COOKIE_NAME, issue_session(db, account, datetime.now(UTC)))
    db.commit()
    return account


@pytest.fixture
def coordinator(db: Session, client: TestClient):
    return sign_in(db, client, AccountRole.COORDINATOR)


@pytest.mark.parametrize("role,status", [(None, 401), (AccountRole.RESPONDER, 403)])
def test_permissions(db, client, role, status):
    if role:
        sign_in(db, client, role)
    for method, path, body in [
        ("GET", URL, None),
        ("PUT", URL, {"weekly": [WINDOW]}),
        ("POST", f"{URL}/exceptions", exception()),
        ("PATCH", f"{URL}/exceptions/{uuid4()}", exception()),
        ("DELETE", f"{URL}/exceptions/{uuid4()}", None),
    ]:
        assert client.request(method, path, json=body).status_code == status
    assert list(db.scalars(select(AuditLog))) == []


def test_put_replaces_and_updates_public(client, coordinator):
    assert client.put(URL, json={"weekly": [WINDOW]}).status_code == 200
    replacement = {**WINDOW, "day_of_week": 5}
    assert client.put(URL, json={"weekly": [replacement]}).json()["weekly"] == [replacement]
    assert client.get("/api/hours").json()["weekly"] == [replacement]
    assert client.put(URL, json={"weekly": []}).json()["weekly"] == []


@pytest.mark.parametrize(
    "windows",
    [
        [{**WINDOW, "day_of_week": -1}],
        [{**WINDOW, "day_of_week": 7}],
        [{**WINDOW, "closes_at": "19:00:00"}],
        [WINDOW, {**WINDOW, "opens_at": "22:00:00"}],
        [{**WINDOW, "closes_at": "02:00:00"}, {**WINDOW, "opens_at": "23:00:00"}],
        [{**WINDOW, "opens_at": "19:00:00Z"}],
    ],
)
def test_invalid_schedule_is_atomic(db, client, coordinator, windows):
    client.put(URL, json={"weekly": [WINDOW]})
    response = client.put(URL, json={"weekly": windows})
    assert response.status_code == 422
    assert response.json()["detail"]
    assert client.get(URL).json()["weekly"] == [WINDOW]
    assert len(list(db.scalars(select(AuditLog)))) == 1


def test_adjacent_and_overnight_windows(client, coordinator):
    windows = [
        {**WINDOW, "opens_at": "09:00:00", "closes_at": "19:00:00"},
        {**WINDOW, "closes_at": "02:00:00"},
        {**WINDOW, "day_of_week": 1, "opens_at": "00:00:00"},
    ]
    assert client.put(URL, json={"weekly": windows}).status_code == 200


@pytest.mark.parametrize(
    "changes",
    [
        {"is_closed": False},
        {"is_closed": False, "opens_at": "19:00:00"},
        {"is_closed": False, "closes_at": "23:00:00"},
        {"is_closed": False, "opens_at": "19:00:00", "closes_at": "19:00:00"},
        {"note": "x" * 201},
    ],
)
def test_exception_validation(client, coordinator, changes):
    item = client.post(f"{URL}/exceptions", json=exception()).json()
    for method, path in [
        ("POST", f"{URL}/exceptions"),
        ("PATCH", f"{URL}/exceptions/{item['id']}"),
    ]:
        response = client.request(method, path, json={**exception(), **changes})
        assert response.status_code == 422
        assert response.json()["detail"]


def test_exception_crud_and_audits(db, client, coordinator):
    client.put(URL, json={"weekly": [WINDOW]})
    response = client.post(f"{URL}/exceptions", json=exception())
    assert response.status_code == 201
    item = response.json()
    path = f"{URL}/exceptions/{item['id']}"
    duplicate = client.post(f"{URL}/exceptions", json=exception())
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "exception_exists"
    updated = {**exception(), "is_closed": False, "opens_at": "23:00:00", "closes_at": "02:00:00"}
    assert client.patch(path, json=updated).status_code == 200
    assert client.get("/api/hours").json()["exceptions"] == [updated]
    assert client.delete(path).json()["id"] == item["id"]
    assert client.get("/api/hours").json()["exceptions"] == []
    entries = list(db.scalars(select(AuditLog).order_by(AuditLog.created_at)))
    assert [e.action for e in entries] == [
        "hours.update",
        "hours_exception.create",
        "hours_exception.update",
        "hours_exception.delete",
    ]
    assert all(e.actor_account_id == coordinator.id and e.details == {} for e in entries)
    assert all(str(e.target_id) == item["id"] for e in entries[1:])


def test_patch_duplicate_and_missing(client, coordinator):
    first = client.post(f"{URL}/exceptions", json=exception()).json()
    other = {**exception(), "date": (today() + timedelta(days=1)).isoformat()}
    second = client.post(f"{URL}/exceptions", json=other).json()
    response = client.patch(f"{URL}/exceptions/{second['id']}", json=exception())
    assert response.status_code == 409
    assert response.json()["code"] == "exception_exists"
    assert client.patch(f"{URL}/exceptions/{first['id']}", json=exception()).status_code == 200
    for method in ("PATCH", "DELETE"):
        response = client.request(method, f"{URL}/exceptions/{uuid4()}", json=exception())
        assert response.status_code == 404


def test_admin_exception_horizon(db, client, coordinator):
    items = [
        HoursException(date=today() + timedelta(days=offset), is_closed=True)
        for offset in (-1, 0, 60, 61, 365)
    ]
    db.add_all(items)
    db.flush()
    expected = [{"date": item.date.isoformat(), "id": str(item.id)} for item in items[1:]]
    for response in (client.get(URL), client.put(URL, json={"weekly": [WINDOW]})):
        assert response.status_code == 200
        assert [
            {"date": e["date"], "id": e["id"]} for e in response.json()["exceptions"]
        ] == expected
    public_exceptions = client.get("/api/hours").json()["exceptions"]
    assert len(public_exceptions) == 2
    assert all("id" not in item for item in public_exceptions)
