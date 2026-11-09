import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Account, Conversation


def load_responder_conversation(
    db: Session,
    id: uuid.UUID,
    account: Account,
    lock: bool = True,
) -> Conversation:
    query = select(Conversation).where(
        Conversation.id == id,
        Conversation.assigned_account_id == account.id,
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)

    conversation = db.scalar(query)

    if conversation is None:
        raise AppError(404, "no_conversation", "No conversation yet.")

    return conversation
