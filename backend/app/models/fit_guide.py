import uuid
from enum import StrEnum

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class Fit(StrEnum):
    GOOD_FIT = "good_fit"
    OTHER_RESOURCE = "other_resource"


class FitGuideItem(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "fit_guide_items"

    fit: Mapped[Fit] = mapped_column(
        Enum(Fit, name="fit", values_callable=lambda fits: [fit.value for fit in fits])
    )
    text: Mapped[str] = mapped_column(String(300))
    resource_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("resources.id", ondelete="SET NULL")
    )
    display_order: Mapped[int] = mapped_column(Integer)
