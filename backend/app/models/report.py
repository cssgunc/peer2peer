import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    SMALLINT,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class ReportOptionKind(enum.StrEnum):
    TOPIC = "topic"
    OUTCOME = "outcome"


class ReportOption(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "report_options"
    kind: Mapped[ReportOptionKind] = mapped_column(
        Enum(
            ReportOptionKind,
            name="report_option_kind",
            values_callable=lambda options: [option.value for option in options],
        )
    )
    label: Mapped[str] = mapped_column(String(100))
    display_order: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean)


class ConversationReport(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "conversation_reports"
    __table_args__ = (
        UniqueConstraint("conversation_id", name="uq_report_conversation_id"),
        CheckConstraint("confidence BETWEEN 1 AND 5", name="ck_conversation_reports_confidence"),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    outcome_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("report_options.id"))
    confidence: Mapped[int] = mapped_column(SMALLINT)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ConversationReportTopic(Base):
    __tablename__ = "conversation_report_topics"
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversation_reports.id"), primary_key=True
    )
    option_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("report_options.id"), primary_key=True)
