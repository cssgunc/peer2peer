import uuid
from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, SmallInteger
from sqlalchemy.dialects.postgresql import BYTEA
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class EscalationStatus(StrEnum):
    # TODO(escalation-protocol): how an escalation moves between these waits on the CAPS protocol.
    OPEN = "open"
    HANDED_OFF = "handed_off"
    CLOSED = "closed"


class Escalation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Sensitive escalation record (TDD 4.5.2). Coordinator-only; every read is audited.

    Read the payload only through `services.escalations.escalation_payload`.
    """

    __tablename__ = "escalations"
    __table_args__ = (
        Index("ix_escalations_conversation_id", "conversation_id"),
        CheckConstraint(
            "(protected_payload IS NULL) = (key_version IS NULL)",
            name="ck_escalations_payload_has_key_version",
        ),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id"))
    created_by_account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    status: Mapped[EscalationStatus] = mapped_column(
        Enum(
            EscalationStatus,
            name="escalation_status",
            values_callable=lambda members: [m.value for m in members],
        ),
        default=EscalationStatus.OPEN,
    )
    # Encrypted with KeyPurpose.ESCALATION, never the message key.
    protected_payload: Mapped[bytes | None] = mapped_column(BYTEA)
    key_version: Mapped[int | None] = mapped_column(SmallInteger)
