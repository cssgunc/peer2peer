import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.main import app
from app.models.faq import Faq
from app.services import revalidate
from app.services.revalidate import TIMEOUT_SECONDS, schedule_revalidation
from tests.test_faqs import login

# Imported before the autouse fixture in conftest.py swaps it for a recorder.
real_request_revalidation = revalidate.request_revalidation

SECRET = "test-revalidate-secret"

FAQ = {"category": "General", "question": "What is this?", "answer_md": "A line."}
STATISTIC = {"label": "Texts", "value": "100"}
FIT = {"fit": "good_fit", "text": "Stress", "display_order": 0}
REPORT_OPTION = {"kind": "topic", "label": "Stress", "display_order": 0, "is_active": True}
RESOURCE = {"name": "Support", "description": "Peer support", "url": "https://example.org"}
TAG = {"name": "Tag"}
EXCEPTION = {"date": (date.today() + timedelta(days=30)).isoformat(), "is_closed": True}

Request = tuple[str, str, dict[str, Any] | None]


def create(client: TestClient, path: str, payload: dict[str, Any]) -> str:
    response = client.post(path, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def two(client: TestClient, path: str, payload: dict[str, Any], key: str) -> list[str]:
    return [create(client, path, {**payload, key: f"{payload[key]} {n}"}) for n in (1, 2)]


def reorder(path: str, payload: dict[str, Any], key: str) -> Callable[[TestClient], Request]:
    def setup(client: TestClient) -> Request:
        ids = two(client, f"/api/admin/{path}", payload, key)
        return "PUT", f"/api/admin/{path}/reorder", {"ids": ids[::-1]}

    return setup


def write(method: str, path: str, payload: dict[str, Any] | None = None):
    """A write on an item made first through the matching create route."""

    def setup(client: TestClient) -> Request:
        item = create(client, path, payload_for[path])
        return method, f"{path}/{item}", payload

    return setup


payload_for: dict[str, dict[str, Any]] = {
    "/api/admin/faqs": FAQ,
    "/api/admin/statistics": STATISTIC,
    "/api/admin/fit-guide": FIT,
    "/api/admin/report-options": REPORT_OPTION,
    "/api/admin/resources": RESOURCE,
    "/api/admin/resource-tags": TAG,
    "/api/admin/hours/exceptions": EXCEPTION,
}


def post(path: str) -> Callable[[TestClient], Request]:
    return lambda client: ("POST", path, payload_for[path])


# (method, route path) -> cases of (setup, tags the write must schedule).
WRITES: dict[tuple[str, str], list[tuple[Callable[[TestClient], Request], list[str]]]] = {
    ("PUT", "/api/admin/hours"): [
        (
            lambda c: (
                "PUT",
                "/api/admin/hours",
                {"weekly": [{"day_of_week": 0, "opens_at": "18:00", "closes_at": "22:00"}]},
            ),
            ["hours"],
        )
    ],
    ("POST", "/api/admin/hours/exceptions"): [(post("/api/admin/hours/exceptions"), ["hours"])],
    ("PATCH", "/api/admin/hours/exceptions/{id}"): [
        (write("PATCH", "/api/admin/hours/exceptions", {**EXCEPTION, "note": "Break"}), ["hours"])
    ],
    ("DELETE", "/api/admin/hours/exceptions/{id}"): [
        (write("DELETE", "/api/admin/hours/exceptions"), ["hours"])
    ],
    ("PUT", "/api/admin/settings/{key}"): [
        (lambda c: ("PUT", "/api/admin/settings/tagline", {"value": "Hi"}), ["settings"])
    ],
    ("PUT", "/api/admin/content/{slug}"): [
        (
            lambda c: ("PUT", "/api/admin/content/home.intro", {"title": "Hi", "body_md": "Hey"}),
            ["content"],
        )
    ],
    ("POST", "/api/admin/faqs"): [(post("/api/admin/faqs"), ["faqs"])],
    ("PATCH", "/api/admin/faqs/{id}"): [
        (write("PATCH", "/api/admin/faqs", {"answer_md": "New"}), ["faqs"])
    ],
    ("DELETE", "/api/admin/faqs/{id}"): [(write("DELETE", "/api/admin/faqs"), ["faqs"])],
    ("POST", "/api/admin/fit-guide"): [(post("/api/admin/fit-guide"), ["fit-guide"])],
    ("PATCH", "/api/admin/fit-guide/{id}"): [
        (write("PATCH", "/api/admin/fit-guide", {"text": "New"}), ["fit-guide"])
    ],
    ("DELETE", "/api/admin/fit-guide/{id}"): [
        (write("DELETE", "/api/admin/fit-guide"), ["fit-guide"])
    ],
    # The public fit guide shows each linked resource, so resource writes refresh it too.
    ("POST", "/api/admin/resources"): [(post("/api/admin/resources"), ["resources", "fit-guide"])],
    ("PATCH", "/api/admin/resources/{id}"): [
        (write("PATCH", "/api/admin/resources", {"name": "New"}), ["resources", "fit-guide"])
    ],
    ("DELETE", "/api/admin/resources/{id}"): [
        (write("DELETE", "/api/admin/resources"), ["resources", "fit-guide"])
    ],
    ("POST", "/api/admin/resource-tags"): [(post("/api/admin/resource-tags"), ["resources"])],
    ("PATCH", "/api/admin/resource-tags/{id}"): [
        (write("PATCH", "/api/admin/resource-tags", {"name": "New"}), ["resources"])
    ],
    ("DELETE", "/api/admin/resource-tags/{id}"): [
        (write("DELETE", "/api/admin/resource-tags"), ["resources"])
    ],
    ("POST", "/api/admin/statistics"): [(post("/api/admin/statistics"), ["statistics"])],
    ("PATCH", "/api/admin/statistics/{id}"): [
        (write("PATCH", "/api/admin/statistics", {"value": "200"}), ["statistics"])
    ],
    ("DELETE", "/api/admin/statistics/{id}"): [
        (write("DELETE", "/api/admin/statistics"), ["statistics"])
    ],
    # Report options only show in the portal.
    ("POST", "/api/admin/report-options"): [(post("/api/admin/report-options"), [])],
    ("PATCH", "/api/admin/report-options/{id}"): [
        (write("PATCH", "/api/admin/report-options", REPORT_OPTION), [])
    ],
    ("PUT", "/api/admin/{collection}/reorder"): [
        (reorder("faqs", FAQ, "question"), ["faqs"]),
        (reorder("statistics", STATISTIC, "label"), ["statistics"]),
        (reorder("fit-guide", FIT, "text"), ["fit-guide"]),
        (reorder("resources", RESOURCE, "name"), ["resources"]),
        (reorder("resource-tags", TAG, "name"), ["resources"]),
        (reorder("report-options", REPORT_OPTION, "label"), []),
    ],
}

# Admin writes that never touch public data, so they don't revalidate anything.
NOT_PUBLIC = {
    ("POST", "/api/admin/accounts"),
    ("PATCH", "/api/admin/accounts/{account_id}"),
    ("POST", "/api/admin/accounts/{account_id}/reset-password"),
    ("PATCH", "/api/admin/feedback/{feedback_id}"),
    ("DELETE", "/api/admin/feedback/{feedback_id}"),
}

CASES = [
    pytest.param(setup, tags, id=f"{method} {path} #{n}")
    for (method, path), cases in WRITES.items()
    for n, (setup, tags) in enumerate(cases)
]


def test_every_admin_write_is_covered():
    # A new admin write fails here until someone decides which public tags it changes.
    routes = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/api/admin")
        for method in operations
        if method != "get"
    }
    assert routes == set(WRITES) | NOT_PUBLIC


@pytest.mark.parametrize(("setup", "tags"), CASES)
def test_admin_write_schedules_its_tags(
    db: Session,
    client: TestClient,
    revalidations: list[list[str]],
    setup: Callable[[TestClient], Request],
    tags: list[str],
):
    login(db, client)
    method, path, payload = setup(client)
    revalidations.clear()
    response = client.request(method, path, json=payload)
    assert response.status_code < 300, response.text
    assert revalidations == ([tags] if tags else [])


def test_failed_write_schedules_nothing(
    db: Session, client: TestClient, revalidations: list[list[str]]
):
    login(db, client)
    response = client.patch("/api/admin/faqs/00000000-0000-0000-0000-000000000000", json={})
    assert response.status_code == 404
    assert revalidations == []


@pytest.fixture
def sending(monkeypatch: pytest.MonkeyPatch) -> list[tuple[urllib.request.Request, float]]:
    """Uses the real request_revalidation with a secret set, capturing what urlopen gets."""
    monkeypatch.setattr(revalidate, "request_revalidation", real_request_revalidation)
    monkeypatch.setattr(get_settings(), "revalidate_secret", SECRET)
    sent: list[tuple[urllib.request.Request, float]] = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args: object) -> None:
            pass

    def urlopen(request: urllib.request.Request, timeout: float) -> Response:
        sent.append((request, timeout))
        return Response()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return sent


def fail_with(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    def urlopen(request: urllib.request.Request, timeout: float):
        raise error

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)


def http_error(status: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(get_settings().revalidate_url, status, "Error", {}, None)  # type: ignore[arg-type]


def test_sends_tags_with_the_secret(sending: list[tuple[urllib.request.Request, float]]):
    revalidate.request_revalidation(["faqs", "fit-guide"])
    [(request, timeout)] = sending
    assert request.full_url == get_settings().revalidate_url
    assert request.get_method() == "POST"
    assert request.get_header("X-revalidate-secret") == SECRET
    assert request.get_header("Content-type") == "application/json"
    assert isinstance(request.data, bytes)
    assert json.loads(request.data) == {"tags": ["faqs", "fit-guide"]}
    assert timeout == TIMEOUT_SECONDS


@pytest.mark.parametrize("secret", [None, ""])
def test_does_nothing_without_a_secret(
    monkeypatch: pytest.MonkeyPatch,
    sending: list[tuple[urllib.request.Request, float]],
    secret: str | None,
):
    monkeypatch.setattr(get_settings(), "revalidate_secret", secret)
    revalidate.request_revalidation(["faqs"])
    assert sending == []


@pytest.mark.parametrize(
    ("error", "logged"),
    [
        (http_error(500), "status=500"),
        (http_error(401), "status=401"),
        (TimeoutError("timed out"), "error=TimeoutError"),
        (urllib.error.URLError("refused"), "error=URLError"),
    ],
)
def test_failure_logs_only_tags_and_status(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sending: list[tuple[urllib.request.Request, float]],
    error: Exception,
    logged: str,
):
    fail_with(monkeypatch, error)
    with caplog.at_level(logging.WARNING, logger="app.revalidate"):
        revalidate.request_revalidation(["faqs"])  # must not raise
    [record] = caplog.records
    assert record.getMessage() == f"Revalidation failed: tags=['faqs'] {logged}"
    assert SECRET not in caplog.text


def test_failed_revalidation_does_not_change_the_response(
    db: Session,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    sending: list[tuple[urllib.request.Request, float]],
):
    login(db, client)
    fail_with(monkeypatch, http_error(500))
    response = client.post("/api/admin/faqs", json=FAQ)
    assert response.status_code == 201
    assert response.json()["question"] == FAQ["question"]
    assert db.scalar(select(Faq).where(Faq.question == FAQ["question"])) is not None


def test_schedule_skips_empty_and_dedupes():
    background = BackgroundTasks()
    schedule_revalidation(background)
    assert background.tasks == []
    schedule_revalidation(background, "resources", "fit-guide", "resources")
    [task] = background.tasks
    assert task.args == (["resources", "fit-guide"],)
