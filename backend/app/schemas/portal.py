import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models import DeliveryStatus, Message, MessageSender
from app.services.messages import message_body


class PortalMessageDTO(BaseModel):
    """A message as a responder sees it. Never includes texter_id or the identity hash."""

    id: uuid.UUID
    sender: MessageSender
    body: str
    created_at: datetime
    delivery_status: DeliveryStatus | None

    @classmethod
    def from_message(cls, message: Message) -> PortalMessageDTO:
        return cls(
            id=message.id,
            sender=message.sender,
            body=message_body(message),
            created_at=message.created_at,
            delivery_status=message.delivery_status,
        )
