import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models import EscalationStatus


class CreatedEscalationDTO(BaseModel):
    id: uuid.UUID


class EscalationDTO(BaseModel):
    """An escalation as coordinators see it (TDD 4.7.1). Never includes texter_id or identity data.

    TODO(escalation-protocol): the final shape waits on the CAPS protocol.
    """

    id: uuid.UUID
    conversation_label: str
    status: EscalationStatus
    created_by_display_name: str
    created_at: datetime


class EscalationDetailDTO(EscalationDTO):
    # Decrypted only for the detail route, which audits every read.
    payload: dict[str, Any] | None
