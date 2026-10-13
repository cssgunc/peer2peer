"""In-memory rate limiting for sign-in, chat, and feedback (TDD 4.6.1, 4.6.2, 4.9).

Keys usually contain a client IP, which must never reach the database or the logs, so all
state lives in process memory and nothing here logs. We run a single backend instance
(TDD 4.2), so memory is enough. Limits reset when the server restarts.
"""

import math
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request, status

# Every this many hits, drop keys whose hits have all aged out of their window.
PRUNE_EVERY = 1000


class RateLimiter:
    """Sliding-window log: each key keeps the timestamps of its allowed hits in the window.

    We chose this over a fixed window because a fixed window lets a client send up to twice
    the limit across a window boundary. The log costs at most `limit` floats per key, which
    is small for the limits we use. Blocked hits aren't recorded, so a client that keeps
    retrying is unblocked as soon as its oldest allowed hit leaves the window.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}
        self._windows: dict[str, float] = {}
        self._hit_count = 0

    def hit(
        self, key: str, limit: int, window_seconds: int, now: float | None = None
    ) -> float | None:
        """Record a hit for `key`. Return None if allowed, else seconds until the next allowed hit.

        `now` is a `time.monotonic()` reading; tests pass it explicitly instead of sleeping.
        """
        if limit < 1 or window_seconds <= 0:
            raise ValueError("limit and window_seconds must be positive")
        if now is None:
            now = time.monotonic()

        with self._lock:
            self._hit_count += 1
            if self._hit_count % PRUNE_EVERY == 0:
                self._prune(now)

            hits = self._hits.setdefault(key, deque())
            self._windows[key] = window_seconds
            cutoff = now - window_seconds
            while hits and hits[0] <= cutoff:
                hits.popleft()

            if len(hits) >= limit:
                return hits[0] + window_seconds - now
            hits.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._windows.clear()
            self._hit_count = 0

    def _prune(self, now: float) -> None:
        # Caller holds the lock. Hits are appended in order, so the newest is last.
        stale = [key for key, hits in self._hits.items() if hits[-1] <= now - self._windows[key]]
        for key in stale:
            del self._hits[key]
            del self._windows[key]


limiter = RateLimiter()


def reset_rate_limits() -> None:
    limiter.reset()


def client_ip(request: Request) -> str:
    # Behind DigitalOcean's proxy this is the proxy's address. When we deploy, read the
    # forwarded header here (and only here) so every limit picks up the change.
    return request.client.host if request.client else "unknown"


def rate_limit(
    name: str,
    limit: int,
    window_seconds: int,
    key: Callable[[Request], str] = client_ip,
) -> Callable[[Request], None]:
    """Build a dependency that allows `limit` requests per `window_seconds` for each key.

    Usage: `@router.post(..., dependencies=[Depends(rate_limit("feedback", 5, 3600))])`.
    Keys are prefixed with `name` so different limits never share counters.
    """

    def dependency(request: Request) -> None:
        retry_after = limiter.hit(f"{name}:{key(request)}", limit, window_seconds)
        if retry_after is not None:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again later.",
                headers={"Retry-After": str(math.ceil(retry_after))},
            )

    return dependency
