import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    false,
)
from sqlalchemy.dialects.postgresql import BYTEA
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin


class Channel(StrEnum):
    WEB = "web"
    SMS = "sms"


class ConversationStatus(StrEnum):
    QUEUED = "queued"
    ACTIVE = "active"
    CLOSED = "closed"


class ClosedBy(StrEnum):
    TEXTER = "texter"
    RESPONDER = "responder"
    INACTIVITY = "inactivity"
    SYSTEM = "system"


class MessageSender(StrEnum):
    TEXTER = "texter"
    RESPONDER = "responder"
    SYSTEM = "system"


class DeliveryStatus(StrEnum):
    RECEIVED = "received"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"


def _enum(enum: type[StrEnum], name: str) -> Enum:
    return Enum(enum, name=name, values_callable=lambda members: [m.value for m in members])


class Texter(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Sensitive pseudonymous identity. Only a hash is stored; never shown to responders."""

    __tablename__ = "texters"
    __table_args__ = (UniqueConstraint("channel", "identity_hash"),)

    channel: Mapped[Channel] = mapped_column(_enum(Channel, "channel"))
    identity_hash: Mapped[bytes] = mapped_column(BYTEA)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Conversation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Internal conversation metadata. Survives the retention purge so analytics keep working."""

    __tablename__ = "conversations"
    __table_args__ = (
        Index("ix_conversations_status", "status"),
        Index("ix_conversations_assigned_account_id_status", "assigned_account_id", "status"),
    )

    texter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("texters.id", ondelete="SET NULL")
    )
    channel: Mapped[Channel] = mapped_column(_enum(Channel, "channel"))
    label_number: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[ConversationStatus] = mapped_column(
        _enum(ConversationStatus, "conversation_status"), default=ConversationStatus.QUEUED
    )
    assigned_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id"))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[ClosedBy | None] = mapped_column(_enum(ClosedBy, "closed_by"))
    opened_after_hours: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    message_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    responder_last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    messages_purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Sensitive message content. Read the body only through `services.messages.message_body`."""

    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_id_created_at", "conversation_id", "created_at"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE")
    )
    sender: Mapped[MessageSender] = mapped_column(_enum(MessageSender, "message_sender"))
    sender_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id"))
    body_ciphertext: Mapped[bytes] = mapped_column(BYTEA)
    key_version: Mapped[int] = mapped_column(SmallInteger)
    provider_message_id: Mapped[str | None] = mapped_column(String(64))
    delivery_status: Mapped[DeliveryStatus | None] = mapped_column(
        _enum(DeliveryStatus, "delivery_status")
    )
