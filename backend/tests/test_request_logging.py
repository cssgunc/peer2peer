import logging
import re

import pytest
from fastapi.testclient import TestClient

from app.logging import RedactWebSocketFilter


@pytest.mark.parametrize(
    "message",
    [
        '203.0.113.1:9000 - "WebSocket /ws/portal?secret=abc" [accepted]',
        '203.0.113.1:9000 - "WebSocket /ws/portal?secret=abc" 403',
        "203.0.113.1:9000 - WebSocket connection made",
        "203.0.113.1:9000 - WebSocket connection lost",
        "ASGI Receive {'type': 'websocket.receive', 'text': 'private content'}",
    ],
)
def test_portal_websocket_logs_are_filtered(message: str) -> None:
    logger = logging.getLogger("uvicorn.error")
    record = logging.LogRecord(logger.name, logging.INFO, "", 0, message, (), None)
    assert any(isinstance(filter, RedactWebSocketFilter) for filter in logger.filters)
    assert not logger.filter(record)


def test_request_log_has_no_query_or_ip(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO):
        client.get("/api/health?secret=abc")

    # Filter by logger name: httpx (used by TestClient) logs the full URL itself
    records = [r for r in caplog.records if r.name == "app.request"]
    assert len(records) == 1
    msg = records[0].getMessage()

    assert "/api/health" in msg and "200" in msg
    assert "secret" not in msg and "abc" not in msg
    assert "testclient" not in msg
    assert not re.search(r"\d+\.\d+\.\d+\.\d+", msg)
