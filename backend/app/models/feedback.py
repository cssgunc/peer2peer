import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

BODY_MAX_LENGTH = 2000


def start_of_utc_day(now: datetime | None = None) -> datetime:
    """Midnight UTC of the current day, so a stored row can't be matched to traffic logs."""
    now = (now or datetime.now(UTC)).astimezone(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


class FeedbackSubmission(Base):
    """Anonymous Contact-page feedback (TDD 4.5.3). Sensitive: free text with no sender.

    Never add columns that could identify the sender (IP, user agent, exact time).
    """

    __tablename__ = "feedback_submissions"
    __table_args__ = (
        CheckConstraint(
            f"char_length(body) BETWEEN 1 AND {BODY_MAX_LENGTH}",
            name="ck_feedback_submissions_body_length",
        ),
    )

    # UUIDv4 rather than the UUIDv7 used elsewhere: v7 embeds a millisecond timestamp,
    # which would undo truncating created_at to the day.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=start_of_utc_day)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
