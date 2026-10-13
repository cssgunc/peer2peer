import logging
import re

import pytest
from fastapi.testclient import TestClient


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
