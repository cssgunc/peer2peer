from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.events import (
    CONVERSATION_CLOSED,
    CONVERSATION_UPDATED,
    portal_topic,
    publish_after_commit,
    texter_topic,
)
from app.models import ClosedBy, Conversation, ConversationStatus
from app.services.site_settings import get_setting


def close_inactive_conversations(db: Session, now: datetime) -> int:
    """Close queued/active conversations whose last message predates the timeout."""
    cutoff = now - timedelta(minutes=get_setting(db, "conversation_inactive_minutes"))
    conversations = db.scalars(
        select(Conversation)
        .where(
            Conversation.status.in_((ConversationStatus.QUEUED, ConversationStatus.ACTIVE)),
            Conversation.last_message_at < cutoff,
        )
        .order_by(Conversation.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    for conversation in conversations:
        conversation.status = ConversationStatus.CLOSED
        conversation.closed_at = now
        conversation.closed_by = ClosedBy.INACTIVITY
        data = {"conversation_id": str(conversation.id), "closed_by": ClosedBy.INACTIVITY.value}
        if conversation.texter_id is not None:
            publish_after_commit(
                db,
                texter_topic(conversation.texter_id),
                {"type": CONVERSATION_CLOSED, "data": data},
            )
        if conversation.assigned_account_id is not None:
            publish_after_commit(
                db,
                portal_topic(conversation.assigned_account_id),
                {
                    "type": CONVERSATION_UPDATED,
                    "data": {**data, "status": ConversationStatus.CLOSED.value},
                },
            )
    db.flush()
    return len(conversations)
