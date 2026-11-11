"""Coordinator escalation view (TDD 4.3.3, 4.6.7).

Every read writes an `escalation.view` audit entry, and the payload is decrypted only here.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account, Conversation, Escalation
from app.schemas.escalations import EscalationDetailDTO, EscalationDTO
from app.services.audit import AuditAction, record_audit
from app.services.escalations import escalation_payload

Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]

router = APIRouter(
    prefix="/admin/escalations",
    tags=["admin"],
    dependencies=[Depends(require_coordinator)],
)

_escalations = (
    select(Escalation, Conversation.label_number, Account.display_name)
    .join(Conversation, Escalation.conversation_id == Conversation.id)
    .join(Account, Escalation.created_by_account_id == Account.id)
)


def _to_dto(escalation: Escalation, label_number: int | None, created_by: str) -> EscalationDTO:
    return EscalationDTO(
        id=escalation.id,
        conversation_label=f"Texter {label_number}" if label_number is not None else "Texter",
        status=escalation.status,
        created_by_display_name=created_by,
        created_at=escalation.created_at,
    )


@router.get("", response_model=list[EscalationDTO])
def list_escalations(db: Database, coordinator: Coordinator) -> list[EscalationDTO]:
    rows = db.execute(_escalations.order_by(Escalation.created_at.desc(), Escalation.id.desc()))
    result = [_to_dto(escalation, label, created_by) for escalation, label, created_by in rows]
    record_audit(
        db, actor_id=coordinator.id, action=AuditAction.ESCALATION_VIEW, target_type="escalation"
    )
    db.commit()
    return result


@router.get("/{escalation_id}", response_model=EscalationDetailDTO)
def get_escalation(
    escalation_id: uuid.UUID, response: Response, db: Database, coordinator: Coordinator
) -> EscalationDetailDTO:
    row = db.execute(_escalations.where(Escalation.id == escalation_id)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Escalation not found")
    escalation, label_number, created_by = row
    result = EscalationDetailDTO(
        **_to_dto(escalation, label_number, created_by).model_dump(),
        payload=escalation_payload(escalation),
    )
    record_audit(
        db,
        actor_id=coordinator.id,
        action=AuditAction.ESCALATION_VIEW,
        target_type="escalation",
        target_id=escalation.id,
    )
    db.commit()

    # The body holds the decrypted payload, so browsers and proxies must not keep a copy.
    response.headers["Cache-Control"] = "no-store"
    return result
