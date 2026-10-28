import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models import Message, MessageSender
from app.services.messages import message_body


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
