import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Account, Conversation


def load_responder_conversation(
    db: Session,
    id: uuid.UUID,
    account: Account,
) -> Conversation:
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.id == id, Conversation.assigned_account_id == account.id
        )
    )

    if conversation is None:
        raise AppError(404, "no_conversation", "No conversation yet.")

    return conversation
