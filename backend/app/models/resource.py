import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class ResourceTag(UUIDPrimaryKeyMixin, Base):
    """Public tag used to filter resources, like Crisis/Urgent or Ongoing Care."""

    __tablename__ = "resource_tags"

    name: Mapped[str] = mapped_column(String(100), unique=True)
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ResourceTagLink(Base):
    """Many-to-many link between resources and tags."""

    __tablename__ = "resource_tag_links"

    resource_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("resource_tags.id", ondelete="CASCADE"), primary_key=True
    )


class Resource(UUIDPrimaryKeyMixin, Base):
    """Public resource listing. UNC resources stay unpublished until they agree to be listed."""

    __tablename__ = "resources"

    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(1000))
    url: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(50))
    is_unc: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    is_crisis: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    tags: Mapped[list[ResourceTag]] = relationship(
        secondary="resource_tag_links",
        order_by=(ResourceTag.display_order, ResourceTag.name),
    )
