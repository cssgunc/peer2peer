import hashlib
from datetime import UTC, datetime, time, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import events
from app.events import CONVERSATION_CLOSED, MESSAGE_CREATED, Event, texter_topic
from app.models import (
    Account,
    AccountRole,
    Channel,
    ClosedBy,
    ConversationStatus,
    Message,
    MessageSender,
    Shift,
)
from app.models.hours import WeeklyHours
from app.models.resource import Resource
from app.services.after_hours import NO_NEXT_OPEN, after_hours_body, format_next_open
from app.services.messages import message_body
from app.services.pipeline import handle_inbound
from app.services.site_settings import set_setting

# Wednesday, Oct 28 2026, noon Eastern (EDT). DST ends Sunday, Nov 1.
NOW = datetime(2026, 10, 28, 16, 0, tzinfo=UTC)
TUESDAY, THURSDAY = 1, 3


def identity(name: str) -> bytes:
    return hashlib.sha256(name.encode()).digest()


def put_responder_on_shift(db: Session) -> None:
    account = Account(
        email="responder@unc.edu",
        display_name="Responder",
        password_hash="unused",
        role=AccountRole.RESPONDER,
    )
    db.add(account)
    db.flush()
    db.add(Shift(account_id=account.id, started_at=NOW, last_heartbeat_at=NOW))
    db.flush()


def add_weekly_hours(db: Session, day_of_week: int, opens_at: time, closes_at: time) -> None:
    db.add(WeeklyHours(day_of_week=day_of_week, opens_at=opens_at, closes_at=closes_at))
    db.flush()


def system_messages(db: Session) -> list[Message]:
    return list(db.scalars(select(Message).where(Message.sender == MessageSender.SYSTEM)))


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Event]]:
    sent: list[tuple[str, Event]] = []
    monkeypatch.setattr(events.event_bus, "publish", lambda topic, e: sent.append((topic, e)))
    return sent


def test_offline_new_conversation_gets_the_reply(
    db: Session, published: list[tuple[str, Event]]
) -> None:
    conversation = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW).conversation
    assert conversation.texter_id is not None

    assert conversation.opened_after_hours
    [reply] = system_messages(db)
    assert reply.conversation_id == conversation.id
    assert published == []
    db.commit()
    replies = [e for topic, e in published if e["type"] == MESSAGE_CREATED]
    assert [r["data"]["message"]["id"] for r in replies] == [str(reply.id)]
    assert all(topic == texter_topic(conversation.texter_id) for topic, _ in published)


def test_online_sends_no_reply(db: Session, published: list[tuple[str, Event]]) -> None:
    put_responder_on_shift(db)

    conversation = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW).conversation
    db.commit()

    assert not conversation.opened_after_hours
    assert conversation.status == ConversationStatus.QUEUED
    assert system_messages(db) == []
    assert published == []


def test_second_message_sends_no_second_reply(db: Session) -> None:
    set_setting(db, "after_hours_behavior", "queue", None)
    first = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW)
    second = handle_inbound(db, Channel.WEB, identity("a"), "anyone?", NOW + timedelta(minutes=1))

    assert second.conversation.id == first.conversation.id
    assert len(system_messages(db)) == 1


def test_close_ends_the_conversation_after_the_reply(
    db: Session, published: list[tuple[str, Event]]
) -> None:
    conversation = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW).conversation
    assert conversation.texter_id is not None

    assert conversation.status == ConversationStatus.CLOSED
    assert conversation.closed_by == ClosedBy.SYSTEM
    assert conversation.closed_at == NOW
    db.commit()
    topic = texter_topic(conversation.texter_id)
    assert [(t, e["type"]) for t, e in published] == [
        (topic, MESSAGE_CREATED),
        (topic, CONVERSATION_CLOSED),
    ]
    assert published[1][1]["data"] == {
        "conversation_id": str(conversation.id),
        "closed_by": "system",
    }


def test_queue_keeps_the_conversation_open(db: Session, published: list[tuple[str, Event]]) -> None:
    set_setting(db, "after_hours_behavior", "queue", None)

    conversation = handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW).conversation
    db.commit()

    assert conversation.status == ConversationStatus.QUEUED
    assert conversation.closed_by is None
    assert [e["type"] for _, e in published] == [MESSAGE_CREATED]


def test_nothing_is_sent_on_rollback(db: Session, published: list[tuple[str, Event]]) -> None:
    handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW)
    db.rollback()
    db.commit()

    assert published == []


def test_next_open_is_formatted_in_eastern_time(db: Session) -> None:
    add_weekly_hours(db, THURSDAY, time(19, 0), time(23, 0))

    assert "Thursday, Oct 29 at 7:00 PM" in after_hours_body(db, NOW)


def test_next_open_after_daylight_saving_ends(db: Session) -> None:
    # 7 PM EST on Nov 3 is midnight UTC on Nov 4.
    add_weekly_hours(db, TUESDAY, time(19, 0), time(23, 0))

    assert "Tuesday, Nov 3 at 7:00 PM" in after_hours_body(db, NOW)


def test_next_open_formats_morning_and_noon_hours() -> None:
    assert format_next_open(datetime(2026, 10, 29, 13, 5, tzinfo=UTC)) == (
        "Thursday, Oct 29 at 9:05 AM"
    )
    assert format_next_open(datetime(2026, 10, 29, 16, 0, tzinfo=UTC)) == (
        "Thursday, Oct 29 at 12:00 PM"
    )


def test_no_opening_in_two_weeks_says_when_we_reopen(db: Session) -> None:
    body = after_hours_body(db, NOW)

    assert NO_NEXT_OPEN in body
    assert "{next_open}" not in body


def test_reply_includes_published_crisis_resources(db: Session) -> None:
    db.add_all(
        [
            Resource(
                name="988 Lifeline",
                description="",
                phone="988",
                is_crisis=True,
                is_published=True,
                display_order=1,
            ),
            Resource(
                name="911",
                description="",
                phone="911",
                is_crisis=True,
                is_published=True,
                display_order=0,
            ),
            Resource(name="Hidden Crisis", description="", phone="555-0100", is_crisis=True),
            Resource(name="Ongoing", description="", phone="555-0101", is_published=True),
            Resource(name="No Phone", description="", is_crisis=True, is_published=True),
        ]
    )
    db.flush()

    handle_inbound(db, Channel.WEB, identity("a"), "hi", NOW)
    [reply] = system_messages(db)
    body = message_body(reply)

    assert body.endswith("\n\n911: 911\n988 Lifeline: 988")
    assert "Hidden Crisis" not in body
    assert "Ongoing" not in body
    assert "No Phone" not in body


@pytest.mark.parametrize("with_unusable_resources", [False, True])
def test_reply_falls_back_to_911_and_988(db: Session, with_unusable_resources: bool) -> None:
    if with_unusable_resources:
        db.add_all(
            [
                Resource(name="Hidden Crisis", description="", phone="555-0100", is_crisis=True),
                Resource(name="No Phone", description="", is_crisis=True, is_published=True),
            ]
        )
        db.flush()

    body = after_hours_body(db, NOW)

    assert body.endswith("\n\nEmergency Services: 911\n988 Suicide & Crisis Lifeline: 988")
