import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account, AuditLog
from app.schemas.audit_log import AuditLogDTO, AuditLogPageDTO
from app.services.audit import AuditAction

PAGE_SIZE = 50

Database = Annotated[Session, Depends(get_db)]
PageNumber = Annotated[int, Query(ge=1)]

router = APIRouter(
    prefix="/admin/audit-log",
    tags=["admin"],
    dependencies=[Depends(require_coordinator)],
)


@router.get("", response_model=AuditLogPageDTO)
def list_audit_log(
    db: Database,
    action: AuditAction | None = None,
    actor: uuid.UUID | None = None,
    page: PageNumber = 1,
) -> AuditLogPageDTO:
    filters = []
    if action is not None:
        filters.append(AuditLog.action == action.value)
    if actor is not None:
        filters.append(AuditLog.actor_account_id == actor)

    total = db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    query = (
        select(AuditLog, Account.display_name)
        .outerjoin(Account, AuditLog.actor_account_id == Account.id)
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
    )
    items = [
        AuditLogDTO(
            id=entry.id,
            actor_display_name=actor_display_name,
            action=entry.action,
            target_type=entry.target_type,
            target_id=entry.target_id,
            created_at=entry.created_at,
        )
        for entry, actor_display_name in db.execute(query)
    ]
    return AuditLogPageDTO(items=items, page=page, page_size=PAGE_SIZE, total=total)
