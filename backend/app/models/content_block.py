import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import utc_now


class ContentBlock(Base):
    """Coordinator-managed Markdown for a section registered in code."""

    __tablename__ = "content_blocks"

    slug: Mapped[str] = mapped_column(String(100), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body_md: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now(), onupdate=utc_now
    )
