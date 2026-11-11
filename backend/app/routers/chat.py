import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.channels.web import WebChatAdapter, hash_token
from app.database import get_db
from app.errors import AppError
from app.events import CONVERSATION_CLOSED, Event, portal_topic, publish_after_commit, texter_topic
from app.models import Channel, ClosedBy, Conversation, ConversationStatus, Message, Texter
from app.schemas.chat import ChatConversationDTO, ChatMessageDTO, ChatSessionDTO, SendMessageDTO
from app.security.rate_limit import check_rate_limit, rate_limit
from app.services.pipeline import OPEN_STATUSES, handle_inbound

router = APIRouter(prefix="/chat", tags=["chat"])
_bearer = HTTPBearer(auto_error=False)


def get_current_texter(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[Session, Depends(get_db)],
) -> Texter:
    if credentials is None:
        raise AppError(401, "invalid_token", "Invalid chat token.")
    return resolve_texter(db, credentials.credentials)


def resolve_texter(db: Session, token: str) -> Texter:
    # Serialize sends and revocation for this texter. A waiting request must recheck
    # revoked_at after the ending request commits before it can open a conversation.
    texter = db.scalar(
        select(Texter)
        .where(
            Texter.channel == Channel.WEB,
            Texter.identity_hash == hash_token(token),
            Texter.revoked_at.is_(None),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if texter is None:
        raise AppError(401, "invalid_token", "Invalid chat token.")
    return texter


def send_texter_message(db: Session, texter: Texter, payload: object) -> ChatMessageDTO:
    """Validate and send through the same per-identity bucket for REST and WebSocket."""
    try:
        message = SendMessageDTO.model_validate(payload)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(part) for part in first["loc"]) or "body"
        raise AppError(422, "validation_error", f"{field}: {first['msg']}") from None
    # No raw token is retained, and switching transports cannot bypass the limit.
    check_rate_limit("chat-messages", texter.identity_hash.hex(), 20, 60)
    result = handle_inbound(
        db, WebChatAdapter.channel, texter.identity_hash, message.body, datetime.now(UTC)
    )
    return ChatMessageDTO.from_message(result.message)


@router.post(
    "/sessions",
    response_model=ChatSessionDTO,
    status_code=201,
    dependencies=[Depends(rate_limit("chat-sessions", 10, 3600))],
)
def create_session(db: Annotated[Session, Depends(get_db)]) -> ChatSessionDTO:
    token = secrets.token_urlsafe(32)
    db.add(
        Texter(
            channel=Channel.WEB,
            identity_hash=hash_token(token),
            last_seen_at=datetime.now(UTC),
        )
    )
    db.commit()
    return ChatSessionDTO(token=token)


@router.get("/conversation", response_model=ChatConversationDTO)
def get_conversation(
    texter: Annotated[Texter, Depends(get_current_texter)],
    db: Annotated[Session, Depends(get_db)],
    after: uuid.UUID | None = None,
) -> ChatConversationDTO:
    conversation = db.scalar(
        select(Conversation)
        .where(Conversation.texter_id == texter.id)
        .order_by(Conversation.opened_at.desc(), Conversation.id.desc())
        .limit(1)
    )
    if conversation is None:
        raise AppError(404, "no_conversation", "No conversation yet.")

    messages = select(Message).where(Message.conversation_id == conversation.id)
    if after is not None:
        cursor = db.scalar(
            select(Message).where(Message.id == after, Message.conversation_id == conversation.id)
        )
        # Unknown and foreign cursors get the same response, revealing no other chat.
        if cursor is None:
            raise AppError(404, "message_not_found", "Message not found in this conversation.")
        messages = messages.where(Message.created_at > cursor.created_at)

    return ChatConversationDTO(
        id=conversation.id,
        status=conversation.status,
        messages=[
            ChatMessageDTO.from_message(message)
            for message in db.scalars(messages.order_by(Message.created_at, Message.id))
        ],
    )


@router.post(
    "/messages",
    response_model=ChatMessageDTO,
    status_code=201,
)
def send_message(
    payload: SendMessageDTO,
    texter: Annotated[Texter, Depends(get_current_texter)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatMessageDTO:
    response = send_texter_message(db, texter, payload)
    db.commit()
    return response


@router.post("/conversation/end", status_code=204)
def end_conversation(
    texter: Annotated[Texter, Depends(get_current_texter)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    now = datetime.now(UTC)
    conversation = db.scalar(
        select(Conversation)
        .where(Conversation.texter_id == texter.id, Conversation.status.in_(OPEN_STATUSES))
        .order_by(Conversation.opened_at.desc())
        .limit(1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    close_event: Event = {"type": CONVERSATION_CLOSED, "data": {"closed_by": "texter"}}
    if conversation is not None:
        conversation.status = ConversationStatus.CLOSED
        conversation.closed_by = ClosedBy.TEXTER
        conversation.closed_at = now
        close_event["data"]["conversation_id"] = str(conversation.id)
        if conversation.assigned_account_id is not None:
            publish_after_commit(
                db,
                portal_topic(conversation.assigned_account_id),
                close_event,
            )
    texter.revoked_at = now
    # Also notify sockets with no open conversation: their token is revoked too.
    publish_after_commit(db, texter_topic(texter.id), close_event)
    db.commit()
