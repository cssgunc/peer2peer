from sqlalchemy import Boolean, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class Faq(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "faqs"

    category: Mapped[str] = mapped_column(String(100))
    question: Mapped[str] = mapped_column(String(300))
    answer_md: Mapped[str] = mapped_column(Text)
    display_order: Mapped[int] = mapped_column(Integer)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
