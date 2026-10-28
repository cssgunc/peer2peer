"""In-process event bus that pushes updates to WebSocket subscribers (TDD 4.6.4).

It only reaches subscribers in this backend process, which is fine while we run one instance.
Keep callers on this interface so it could move to Postgres LISTEN/NOTIFY later.

Services never publish directly: they call `publish_after_commit`, so a client never hears about
a row it can't load yet. Events must never carry texter identity (to the portal) or a
responder's name (to texters).
"""

import asyncio
import threading
import uuid
from collections.abc import Callable
from typing import Any, TypedDict

from sqlalchemy import event as sa_event
from sqlalchemy.orm import Session

MESSAGE_CREATED = "message.created"
CONVERSATION_CREATED = "conversation.created"
CONVERSATION_UPDATED = "conversation.updated"
CONVERSATION_CLOSED = "conversation.closed"
STATUS_CHANGED = "status.changed"
SHIFT_ENDED = "shift.ended"
SESSION_REVOKED = "session.revoked"


class Event(TypedDict):
    type: str
    data: dict[str, Any]


def portal_topic(account_id: uuid.UUID) -> str:
    return f"portal:{account_id}"


def texter_topic(texter_id: uuid.UUID) -> str:
    return f"texter:{texter_id}"


class EventBus:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Each queue belongs to the event loop that subscribed, which may not be the publisher's.
        self._subscribers: dict[str, dict[asyncio.Queue[Event], asyncio.AbstractEventLoop]] = {}

    def subscribe(self, topic: str) -> asyncio.Queue[Event]:
        """Return a queue that receives every event published to `topic`. Call from async code."""
        queue: asyncio.Queue[Event] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        with self._lock:
            self._subscribers.setdefault(topic, {})[queue] = loop
        return queue

    def unsubscribe(self, topic: str, queue: asyncio.Queue[Event]) -> None:
        with self._lock:
            queues = self._subscribers.get(topic)
            if queues is not None:
                queues.pop(queue, None)
                if not queues:
                    del self._subscribers[topic]

    def publish(self, topic: str, event: Event) -> None:
        """Deliver `event` to every subscriber of `topic`. Safe to call from any thread."""
        with self._lock:
            subscribers = list(self._subscribers.get(topic, {}).items())
        for queue, loop in subscribers:
            loop.call_soon_threadsafe(queue.put_nowait, event)


event_bus = EventBus()

_AFTER_COMMIT_KEY = "after_commit_callbacks"


def run_after_commit(db: Session, callback: Callable[[], None]) -> None:
    """Run `callback` once the session's transaction commits; drop it if it rolls back."""
    db.info.setdefault(_AFTER_COMMIT_KEY, []).append(callback)


def publish_after_commit(db: Session, topic: str, event: Event) -> None:
    run_after_commit(db, lambda: event_bus.publish(topic, event))


@sa_event.listens_for(Session, "after_commit")
def _run_callbacks(session: Session) -> None:
    for callback in session.info.pop(_AFTER_COMMIT_KEY, []):
        callback()


@sa_event.listens_for(Session, "after_rollback")
def _drop_callbacks(session: Session) -> None:
    session.info.pop(_AFTER_COMMIT_KEY, None)
