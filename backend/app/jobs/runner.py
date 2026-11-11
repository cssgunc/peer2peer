"""Shared execution for the in-process timer and the one-shot CLI command."""

import asyncio
import logging
from contextlib import suppress
from datetime import UTC, datetime

from starlette.concurrency import run_in_threadpool

from app.database import SessionLocal
from app.jobs import close_idle_sessions, close_inactive_conversations, close_lost_shifts

logger = logging.getLogger("app.jobs")
JOB_INTERVAL_SECONDS = 60
# Idle expiry takes precedence when both the session and heartbeat are stale.
JOBS = (close_idle_sessions, close_lost_shifts, close_inactive_conversations)


def run_jobs_once(now: datetime | None = None) -> bool:
    """Run all jobs in separate transactions. Return whether every job succeeded."""
    now = now if now is not None else datetime.now(UTC)
    succeeded = True
    for job in JOBS:
        try:
            with SessionLocal.begin() as db:
                job(db, now)
        except Exception as error:
            # Exception text/tracebacks may contain SQL parameters or other sensitive data.
            logger.error("%s %s", job.__name__, type(error).__name__)
            succeeded = False
    return succeeded


async def run_background_jobs(stop: asyncio.Event) -> None:
    """Run immediately, then every minute; finish an in-flight pass before stopping."""
    while not stop.is_set():
        await run_in_threadpool(run_jobs_once)
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=JOB_INTERVAL_SECONDS)
