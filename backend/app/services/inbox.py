import uuid
from datetime import datetime
from typing import NamedTuple

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session

from app.events import CONVERSATION_UPDATED, portal_topic, publish_after_commit
from app.models import (
    Channel,
    Conversation,
    ConversationReport,
    ConversationStatus,
    Message,
    MessageSender,
)


class InboxRow(NamedTuple):
    id: uuid.UUID
    label_number: int | None
    channel: Channel
    status: ConversationStatus
    opened_at: datetime
    last_message_at: datetime | None
    unread_count: int
    has_report: bool


def list_inbox(db: Session, account_id: uuid.UUID) -> list[InboxRow]:
    """The responder's open conversations plus closed ones awaiting a report, in one query.

    Selects columns rather than the entity so texter_id is never loaded.
    """
    unread_count = (
        select(func.count())
        .select_from(Message)
        .where(
            Message.conversation_id == Conversation.id,
            Message.sender == MessageSender.TEXTER,
            # Never read means every texter message is unread.
            or_(
                Conversation.responder_last_read_at.is_(None),
                Message.created_at > Conversation.responder_last_read_at,
            ),
        )
        .correlate(Conversation)
        .scalar_subquery()
    )
    has_report = exists().where(ConversationReport.conversation_id == Conversation.id)
    rows = db.execute(
        select(
            Conversation.id,
            Conversation.label_number,
            Conversation.channel,
            Conversation.status,
            Conversation.opened_at,
            Conversation.last_message_at,
            unread_count.label("unread_count"),
            has_report.label("has_report"),
        )
        .where(
            Conversation.assigned_account_id == account_id,
            or_(
                Conversation.status.in_([ConversationStatus.QUEUED, ConversationStatus.ACTIVE]),
                and_(Conversation.status == ConversationStatus.CLOSED, ~has_report),
            ),
        )
        .order_by(
            Conversation.last_message_at.desc().nulls_last(),
            Conversation.opened_at.desc(),
            Conversation.id,
        )
    )
    return [InboxRow(*row) for row in rows]


def mark_read(
    db: Session, account_id: uuid.UUID, conversation_id: uuid.UUID, now: datetime
) -> Conversation | None:
    """Clear unread on the responder's own conversation; None if missing or not theirs."""
    # Filtering on the assignee makes someone else's conversation look the same as a missing id.
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.assigned_account_id == account_id
        )
    )
    if conversation is None:
        return None
    conversation.responder_last_read_at = now
    db.flush()
    # Lets the responder's other tabs clear the badge too.
    publish_after_commit(
        db,
        portal_topic(account_id),
        {
            "type": CONVERSATION_UPDATED,
            "data": {"conversation_id": str(conversation.id), "unread_count": 0},
        },
    )
    return conversation
