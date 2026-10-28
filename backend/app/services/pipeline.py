"""The one path every message takes, whatever the channel (TDD 4.6.3).

Like every service, these functions only flush. The caller commits, and that commit fires the
events and adapter sends queued here. Assignment (TDD 4.6.6) is connected later.
"""

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.channels.base import ChannelAdapter
from app.channels.web import WebChatAdapter
from app.config import get_settings
from app.events import MESSAGE_CREATED, Event, portal_topic, publish_after_commit, run_after_commit
from app.models import (
    Account,
    Channel,
    Conversation,
    ConversationStatus,
    Message,
    MessageSender,
    Texter,
)
from app.schemas.portal import PortalMessageDTO
from app.services.messages import add_message

ADAPTERS: dict[Channel, ChannelAdapter] = {Channel.WEB: WebChatAdapter()}

# Any constant works; it only has to be the same everywhere labels are picked.
LABEL_LOCK_KEY = 4_746_301

OPEN_STATUSES = (ConversationStatus.QUEUED, ConversationStatus.ACTIVE)


@dataclass(frozen=True)
class InboundResult:
    conversation: Conversation
    message: Message
    is_new_conversation: bool


def handle_inbound(
    db: Session,
    channel: Channel,
    identity_hash: bytes,
    body: str,
    now: datetime,
    provider_message_id: str | None = None,
) -> InboundResult:
    texter = db.scalar(
        select(Texter).where(Texter.channel == channel, Texter.identity_hash == identity_hash)
    )
    if texter is None:
        texter = Texter(channel=channel, identity_hash=identity_hash, last_seen_at=now)
        db.add(texter)
        db.flush()
    else:
        texter.last_seen_at = now

    conversation = db.scalar(
        select(Conversation)
        .where(Conversation.texter_id == texter.id, Conversation.status.in_(OPEN_STATUSES))
        .order_by(Conversation.opened_at.desc())
    )
    is_new_conversation = conversation is None
    if conversation is None:
        conversation = Conversation(
            texter_id=texter.id,
            channel=channel,
            label_number=_next_label_number(db, now),
            status=ConversationStatus.QUEUED,
            opened_at=now,
        )
        db.add(conversation)
        db.flush()

    message = add_message(db, conversation, MessageSender.TEXTER, body, now)
    if provider_message_id is not None:
        message.provider_message_id = provider_message_id
        db.flush()

    if conversation.assigned_account_id is not None:
        publish_after_commit(
            db,
            portal_topic(conversation.assigned_account_id),
            _portal_message_event(conversation, message),
        )
    return InboundResult(conversation, message, is_new_conversation)


def send_responder_message(
    db: Session, conversation: Conversation, account: Account, body: str, now: datetime
) -> Message:
    if conversation.first_response_at is None:
        conversation.first_response_at = now
    message = add_message(
        db, conversation, MessageSender.RESPONDER, body, now, sender_account_id=account.id
    )

    adapter = ADAPTERS[conversation.channel]
    run_after_commit(db, lambda: adapter.send(conversation, message))
    # The responder's other tabs show the message too.
    publish_after_commit(db, portal_topic(account.id), _portal_message_event(conversation, message))
    return message


def _portal_message_event(conversation: Conversation, message: Message) -> Event:
    return {
        "type": MESSAGE_CREATED,
        "data": {
            "conversation_id": str(conversation.id),
            "message": PortalMessageDTO.from_message(message).model_dump(mode="json"),
        },
    }


def _next_label_number(db: Session, now: datetime) -> int:
    """The N in "Texter N": restarts at 1 each day in the line's local (Eastern) time."""
    # Held until the transaction ends, so two new conversations can't pick the same number.
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LABEL_LOCK_KEY})
    zone = ZoneInfo(get_settings().line_timezone)
    day = now.astimezone(zone).date()
    day_start = datetime.combine(day, time(), zone)
    day_end = datetime.combine(day + timedelta(days=1), time(), zone)
    highest = db.scalar(
        select(func.max(Conversation.label_number)).where(
            Conversation.opened_at >= day_start, Conversation.opened_at < day_end
        )
    )
    return (highest or 0) + 1
