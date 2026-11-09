import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.models import ConversationStatus, Message, MessageSender
from app.services.messages import message_body


class ChatSessionDTO(BaseModel):
    token: str
    conversation_id: uuid.UUID | None = None


class SendMessageDTO(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class ChatMessageDTO(BaseModel):
    """A message as the texter sees it. Never includes the responder's name or account."""

    id: uuid.UUID
    sender: MessageSender
    body: str
    created_at: datetime

    @classmethod
    def from_message(cls, message: Message) -> ChatMessageDTO:
        return cls(
            id=message.id,
            sender=message.sender,
            body=message_body(message),
            created_at=message.created_at,
        )


class ChatConversationDTO(BaseModel):
    id: uuid.UUID
    status: ConversationStatus
    messages: list[ChatMessageDTO]
