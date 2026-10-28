import asyncio
import hashlib
import threading
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import events
from app.events import MESSAGE_CREATED, Event, EventBus, portal_topic, texter_topic
from app.models import Account, AccountRole, Channel, ConversationStatus, Texter
from app.services.pipeline import handle_inbound, send_responder_message

NOW = datetime(2026, 10, 28, 16, 0, tzinfo=UTC)


def identity(name: str) -> bytes:
    return hashlib.sha256(name.encode()).digest()


def make_responder(db: Session) -> Account:
    account = Account(
        email="responder@unc.edu",
        display_name="Responder",
        password_hash="unused",
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.flush()
    return account


def test_first_message_creates_texter_and_queued_conversation(db: Session) -> None:
    result = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW)

    assert result.is_new_conversation
    assert result.conversation.status == ConversationStatus.QUEUED
    assert result.conversation.label_number == 1
    assert result.conversation.message_count == 1
    texter = db.get(Texter, result.conversation.texter_id)
    assert texter is not None
    assert texter.identity_hash == identity("a")


def test_second_message_joins_the_same_conversation(db: Session) -> None:
    first = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW)
    later = NOW + timedelta(minutes=1)
    second = handle_inbound(db, Channel.WEB, identity("a"), "still here", later)

    assert not second.is_new_conversation
    assert second.conversation.id == first.conversation.id
    assert second.conversation.message_count == 2
    assert db.scalar(select(func.count()).select_from(Texter)) == 1
    texter = db.get(Texter, first.conversation.texter_id)
    assert texter is not None
    assert texter.last_seen_at == later


def test_message_after_close_opens_a_new_conversation(db: Session) -> None:
    first = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW)
    first.conversation.status = ConversationStatus.CLOSED
    db.flush()

    second = handle_inbound(db, Channel.WEB, identity("a"), "back again", NOW)

    assert second.is_new_conversation
    assert second.conversation.id != first.conversation.id
    assert second.conversation.texter_id == first.conversation.texter_id


def test_labels_count_up_and_restart_the_next_eastern_day(db: Session) -> None:
    # 03:30 UTC on Oct 29 is still Oct 28 in Eastern time; 04:30 UTC is Oct 29.
    times = [
        datetime(2026, 10, 28, 14, 0, tzinfo=UTC),
        datetime(2026, 10, 28, 20, 0, tzinfo=UTC),
        datetime(2026, 10, 29, 3, 30, tzinfo=UTC),
        datetime(2026, 10, 29, 4, 30, tzinfo=UTC),
    ]
    labels = [
        handle_inbound(db, Channel.WEB, identity(f"t{i}"), "hi", at).conversation.label_number
        for i, at in enumerate(times)
    ]

    assert labels == [1, 2, 3, 1]


def test_first_response_at_is_set_once(db: Session) -> None:
    responder = make_responder(db)
    conversation = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW).conversation

    send_responder_message(db, conversation, responder, "hello", NOW + timedelta(minutes=1))
    send_responder_message(db, conversation, responder, "still here", NOW + timedelta(minutes=2))

    assert conversation.first_response_at == NOW + timedelta(minutes=1)


def test_events_publish_only_after_commit(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    published: list[tuple[str, Event]] = []
    monkeypatch.setattr(events.event_bus, "publish", lambda topic, e: published.append((topic, e)))
    responder = make_responder(db)
    conversation = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW).conversation
    assert conversation.texter_id is not None

    send_responder_message(db, conversation, responder, "hello", NOW)
    assert published == []
    db.commit()
    assert [(topic, e["type"]) for topic, e in published] == [
        (texter_topic(conversation.texter_id), MESSAGE_CREATED),
        (portal_topic(responder.id), MESSAGE_CREATED),
    ]
    assert all(e["data"]["message"]["body"] == "hello" for _, e in published)

    published.clear()
    send_responder_message(db, conversation, responder, "never sent", NOW)
    db.rollback()
    db.commit()
    assert published == []


def test_event_bus_delivers_when_published_from_another_thread() -> None:
    bus = EventBus()
    event: Event = {"type": MESSAGE_CREATED, "data": {"id": "1"}}

    async def receive() -> Event:
        queue = bus.subscribe("topic")
        thread = threading.Thread(target=bus.publish, args=("topic", event))
        thread.start()
        thread.join()
        return await asyncio.wait_for(queue.get(), timeout=1)

    assert asyncio.run(receive()) == event
