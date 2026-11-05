import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models import Channel, ConversationStatus, DeliveryStatus, Message, MessageSender
from app.services.inbox import InboxRow
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


class InboxItemDTO(BaseModel):
    """One inbox row. Never includes texter_id or the identity hash."""

    conversation_id: uuid.UUID
    label: str
    channel: Channel
    status: ConversationStatus
    opened_at: datetime
    last_message_at: datetime | None
    unread_count: int
    needs_report: bool

    @classmethod
    def from_row(cls, row: InboxRow) -> InboxItemDTO:
        return cls(
            conversation_id=row.id,
            # label_number is always set by handle_inbound; never show "Texter None".
            label="Texter" if row.label_number is None else f"Texter {row.label_number}",
            channel=row.channel,
            status=row.status,
            opened_at=row.opened_at,
            last_message_at=row.last_message_at,
            unread_count=row.unread_count,
            needs_report=row.status == ConversationStatus.CLOSED and not row.has_report,
        )
