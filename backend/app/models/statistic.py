from sqlalchemy import Boolean, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class Statistic(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "statistics"

    label: Mapped[str] = mapped_column(String(200))
    value: Mapped[str] = mapped_column(String(50))
    display_order: Mapped[int] = mapped_column(Integer)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
