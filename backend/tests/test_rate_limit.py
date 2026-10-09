import logging
import threading

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.security.rate_limit import PRUNE_EVERY, RateLimiter, rate_limit

# Documentation-range address (RFC 5737), distinctive enough to search log output for.
CLIENT_IP = "203.0.113.7"


@pytest.fixture
def limited_client() -> TestClient:
    # Throwaway app so these tests don't depend on which real routes are rate-limited.
    app = FastAPI()

    @app.get("/limited", dependencies=[Depends(rate_limit("test", limit=2, window_seconds=60))])
    def limited() -> dict[str, str]:
        return {"status": "ok"}

    return TestClient(app, client=(CLIENT_IP, 50000))


def test_allows_hits_up_to_the_limit_then_blocks() -> None:
    limiter = RateLimiter()

    assert [limiter.hit("k", limit=3, window_seconds=10, now=100.0) for _ in range(3)] == [
        None,
        None,
        None,
    ]
    assert limiter.hit("k", limit=3, window_seconds=10, now=100.0) == 10.0


def test_unblocks_after_the_window_slides_past_the_oldest_hit() -> None:
    limiter = RateLimiter()
    limiter.hit("k", limit=2, window_seconds=10, now=100.0)
    limiter.hit("k", limit=2, window_seconds=10, now=105.0)

    assert limiter.hit("k", limit=2, window_seconds=10, now=108.0) == 2.0
    assert limiter.hit("k", limit=2, window_seconds=10, now=110.0) is None
    # The hit at 105 is still in the window, so the third slot is taken again.
    assert limiter.hit("k", limit=2, window_seconds=10, now=111.0) == 4.0


def test_different_keys_do_not_affect_each_other() -> None:
    limiter = RateLimiter()
    limiter.hit("a", limit=1, window_seconds=10, now=100.0)

    assert limiter.hit("a", limit=1, window_seconds=10, now=100.0) is not None
    assert limiter.hit("b", limit=1, window_seconds=10, now=100.0) is None


def test_prunes_keys_whose_hits_have_expired() -> None:
    limiter = RateLimiter()
    for i in range(PRUNE_EVERY - 1):
        limiter.hit(f"old-{i}", limit=1, window_seconds=10, now=100.0)

    limiter.hit("new", limit=1, window_seconds=10, now=200.0)

    assert list(limiter._hits) == ["new"]


def test_concurrent_hits_never_exceed_the_limit() -> None:
    limiter = RateLimiter()
    results: list[float | None] = []

    def hammer() -> None:
        for _ in range(50):
            results.append(limiter.hit("k", limit=100, window_seconds=60))

    threads = [threading.Thread(target=hammer) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results.count(None) == 100


def test_dependency_returns_429_with_retry_after(limited_client: TestClient) -> None:
    assert limited_client.get("/limited").status_code == 200
    assert limited_client.get("/limited").status_code == 200

    response = limited_client.get("/limited")

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"


def test_key_never_shows_up_in_log_output(
    limited_client: TestClient,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with caplog.at_level(logging.DEBUG):
        for _ in range(3):
            limited_client.get("/limited")

    captured = capsys.readouterr()
    for output in (caplog.text, captured.out, captured.err):
        assert CLIENT_IP not in output
