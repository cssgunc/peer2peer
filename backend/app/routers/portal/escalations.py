import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_on_shift
from app.models import Account, Conversation
from app.schemas.escalations import CreatedEscalationDTO
from app.services.audit import AuditAction, record_audit
from app.services.escalations import create_escalation

router = APIRouter(prefix="/portal/conversations", tags=["portal"])


@router.post(
    "/{conversation_id}/escalate",
    response_model=CreatedEscalationDTO,
    status_code=status.HTTP_201_CREATED,
)
def escalate(
    conversation_id: uuid.UUID,
    account: Annotated[Account, Depends(require_on_shift)],
    db: Annotated[Session, Depends(get_db)],
) -> CreatedEscalationDTO:
    conversation = db.get(Conversation, conversation_id)
    # 404, not 403, so responders can't learn which other conversations exist.
    if conversation is None or conversation.assigned_account_id != account.id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    escalation = create_escalation(db, conversation, account)
    record_audit(
        db,
        actor_id=account.id,
        action=AuditAction.ESCALATION_CREATE,
        target_type="escalation",
        target_id=escalation.id,
    )
    # TODO(escalation-protocol): who gets contacted, and how, waits on the CAPS protocol.
    db.commit()
    return CreatedEscalationDTO(id=escalation.id)
