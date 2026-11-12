from datetime import datetime, timedelta

from sqlalchemy import delete, exists, select, update
from sqlalchemy.orm import Session

from app.models import (
    AuthSession,
    Conversation,
    Escalation,
    EscalationStatus,
    FeedbackSubmission,
    Message,
    Texter,
)
from app.services.site_settings import get_setting

# One batch per run keeps each transaction short; the runner calls this every minute,
# so a backlog drains a batch at a time and an empty pass is a single index lookup.
PURGE_BATCH_SIZE = 500


def purge_expired_content(db: Session, now: datetime) -> int:
    """Delete expired message content, unlink texters, and drop expired sessions and feedback.

    Conversation rows and reports stay so analytics keep working (TDD 4.6.7). Conversations
    with an escalation that isn't closed are skipped and purged once it closes.
    """
    message_cutoff = now - timedelta(days=get_setting(db, "message_retention_days"))
    feedback_cutoff = now - timedelta(days=get_setting(db, "feedback_retention_days"))

    # SKIP LOCKED also skips a conversation while an escalation insert holds its key-share lock.
    rows = db.execute(
        select(Conversation.id, Conversation.texter_id)
        .where(
            Conversation.closed_at < message_cutoff,
            Conversation.messages_purged_at.is_(None),
            ~exists().where(
                Escalation.conversation_id == Conversation.id,
                Escalation.status != EscalationStatus.CLOSED,
            ),
        )
        .order_by(Conversation.closed_at, Conversation.id)
        .limit(PURGE_BATCH_SIZE)
        .with_for_update(skip_locked=True)
    ).all()
    conversation_ids = [row.id for row in rows]
    texter_ids = {row.texter_id for row in rows if row.texter_id is not None}

    if conversation_ids:
        db.execute(delete(Message).where(Message.conversation_id.in_(conversation_ids)))
        db.execute(
            update(Conversation)
            .where(Conversation.id.in_(conversation_ids))
            .values(texter_id=None, messages_purged_at=now)
        )
    if texter_ids:
        # Only texters this pass unlinked: a new web texter has no conversation yet.
        db.execute(
            delete(Texter).where(
                Texter.id.in_(texter_ids),
                ~exists().where(Conversation.texter_id == Texter.id),
            )
        )
    db.execute(delete(AuthSession).where(AuthSession.expires_at < now))
    db.execute(delete(FeedbackSubmission).where(FeedbackSubmission.created_at < feedback_cutoff))
    db.flush()
    return len(conversation_ids)
