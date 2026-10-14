import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, true
from sqlalchemy.dialects.postgresql import BYTEA, CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin


class AccountRole(StrEnum):
    RESPONDER = "responder"
    COORDINATOR = "coordinator"


class Account(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Internal staff data; display names must never be exposed to texters."""

    __tablename__ = "accounts"

    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[AccountRole] = mapped_column(
        Enum(
            AccountRole, name="account_role", values_callable=lambda roles: [r.value for r in roles]
        )
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthSession(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Internal staff session data. Only token hashes are persisted."""

    __tablename__ = "auth_sessions"

    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), index=True)
    token_hash: Mapped[bytes] = mapped_column(BYTEA, unique=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
