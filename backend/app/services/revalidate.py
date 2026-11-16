"""Tells Next.js which public cache tags to drop after an admin save (TDD 4.6.8)."""

import json
import logging
import urllib.error
import urllib.request
from typing import Literal

from fastapi import BackgroundTasks

from app.config import get_settings

logger = logging.getLogger("app.revalidate")

# Must match frontend/src/lib/cache-tags.ts; the frontend rejects any other tag with a 400.
RevalidateTag = Literal[
    "content", "faqs", "fit-guide", "hours", "resources", "settings", "statistics"
]

TIMEOUT_SECONDS = 3


def request_revalidation(tags: list[RevalidateTag]) -> None:
    """POST the tags to the frontend. Never raises, so a failure can't affect the save."""
    settings = get_settings()
    if not settings.revalidate_secret:
        return

    request = urllib.request.Request(
        settings.revalidate_url,
        data=json.dumps({"tags": tags}).encode(),
        headers={
            "Content-Type": "application/json",
            "x-revalidate-secret": settings.revalidate_secret,
        },
        method="POST",
    )
    # Log only the tags and the status (or error type): never the secret or the response body.
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS):
            pass
    except urllib.error.HTTPError as exc:
        logger.warning("Revalidation failed: tags=%s status=%d", tags, exc.code)
    except Exception as exc:
        logger.warning("Revalidation failed: tags=%s error=%s", tags, type(exc).__name__)


def schedule_revalidation(background: BackgroundTasks, *tags: RevalidateTag) -> None:
    """Revalidate the tags after the response is sent, which is after the route's commit."""
    if tags:
        background.add_task(request_revalidation, list(dict.fromkeys(tags)))
