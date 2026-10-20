import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class ShiftEndReason(enum.StrEnum):
    MANUAL = "manual"
    SIGNED_OUT = "signed_out"
    IDLE = "idle"
    HEARTBEAT_LOST = "heartbeat_lost"
    DEACTIVATED = "deactivated"


class Shift(UUIDPrimaryKeyMixin, Base):
    """Internal shift data about responder's on-shift window."""

    __tablename__ = "shifts"
    __table_args__ = (
        Index(
            "uq_shifts_one_open_per_account",
            "account_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
        ),
    )
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_reason: Mapped[ShiftEndReason] = mapped_column(
        Enum(
            ShiftEndReason,
            name="shift_end_reason",
            values_callable=lambda members: [member.value for member in members],
        )
    )
