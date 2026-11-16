import uuid
from datetime import datetime

from pydantic import BaseModel

from app.services.audit import AuditAction


class AuditLogDTO(BaseModel):
    """Summary of an audit event. Deliberately excludes the metadata column (TDD 4.7.1)."""

    id: int
    actor_display_name: str | None
    action: AuditAction
    target_type: str
    target_id: uuid.UUID | None
    created_at: datetime


class AuditLogPageDTO(BaseModel):
    items: list[AuditLogDTO]
    page: int
    page_size: int
    total: int
