import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_on_shift
from app.errors import AppError
from app.events import (
    CONVERSATION_CLOSED,
    CONVERSATION_UPDATED,
    portal_topic,
    publish_after_commit,
    texter_topic,
)
from app.models import Account, ClosedBy, ConversationStatus, Message
from app.schemas.chat import SendMessageDTO
from app.schemas.portal import PortalConversationDTO, PortalMessageDTO
from app.security.rate_limit import rate_limit
from app.services.conversations import load_responder_conversation
from app.services.pipeline import send_responder_message

router = APIRouter(prefix="/portal/conversations", tags=["Conversatios"])


def limit_portal_messages(
    request: Request,
    account: Annotated[Account, Depends(require_on_shift)],
) -> None:
    rate_limit(
        "portal-messages",
        limit=20,
        window_seconds=60,
        key=lambda _request: account.id.hex,
    )(request)


#     GET /api/portal/conversations/{id}?after=<message_id>:
# decrypted messages in order,
# either all of them or only those after after


@router.get("/{id}", response_model=PortalConversationDTO)
def get_conversation(
    id: uuid.UUID,
    account: Annotated[Account, Depends(require_on_shift)],
    db: Annotated[Session, Depends(get_db)],
    after: uuid.UUID | None = None,
) -> PortalConversationDTO:
    conversation = load_responder_conversation(db, id, account)

    messages = select(Message).where(Message.conversation_id == conversation.id)

    # reassigns messages if after is not null
    if after is not None:
        cursor = db.scalar(
            select(Message).where(Message.id == after, Message.conversation_id == conversation.id)
        )
        if cursor is None:
            raise AppError(404, "message_not_found", "Message not found in this conversation.")
        messages = messages.where(
            or_(
                Message.created_at > cursor.created_at,
                and_(Message.created_at == cursor.created_at, Message.id > cursor.id),
            )
        )

    message_rows = db.scalars(messages.order_by(Message.created_at, Message.id)).all()
    message_dtos = [PortalMessageDTO.from_message(message) for message in message_rows]

    return PortalConversationDTO(id=conversation.id, messages=message_dtos)


@router.post(
    "/{id}/messages",
    response_model=PortalMessageDTO,
    status_code=201,
    dependencies=[Depends(limit_portal_messages)],
)
def send_message(
    id: uuid.UUID,
    payload: SendMessageDTO,
    account: Annotated[Account, Depends(require_on_shift)],
    db: Annotated[Session, Depends(get_db)],
) -> PortalMessageDTO:
    conversation = load_responder_conversation(db, id, account)

    if conversation.status == ConversationStatus.CLOSED:
        raise AppError(409, "conversation_closed", "Conversation already closed.")

    result = send_responder_message(db, conversation, account, payload.body, datetime.now(UTC))
    response = PortalMessageDTO.from_message(result)
    db.commit()
    return response


@router.post("/{id}/end", status_code=204)
def end_conversation(
    id: uuid.UUID,
    account: Annotated[Account, Depends(require_on_shift)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    now = datetime.now(UTC)
    conversation = load_responder_conversation(db, id, account)

    if conversation.status != ConversationStatus.CLOSED:
        conversation.status = ConversationStatus.CLOSED
        conversation.closed_at = now
        conversation.closed_by = ClosedBy.RESPONDER

        publish_after_commit(
            db,
            portal_topic(account.id),
            {
                "type": CONVERSATION_UPDATED,
                "data": {"conversation_id": str(conversation.id), "closed_by": ClosedBy.RESPONDER},
            },
        )

        if conversation.texter_id is not None:
            publish_after_commit(
                db,
                texter_topic(conversation.texter_id),
                {
                    "type": CONVERSATION_CLOSED,
                    "data": {
                        "conversation_id": str(conversation.id),
                        "closed_by": ClosedBy.RESPONDER,
                    },
                },
            )

    db.commit()
