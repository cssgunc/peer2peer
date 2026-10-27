import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account
from app.models.faq import Faq
from app.schemas.faqs import AdminFaqDTO, FaqInputDTO, FaqPatchDTO
from app.services.audit import AuditAction, record_audit

router = APIRouter(prefix="/admin/faqs", tags=["admin faqs"])
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


def get_item(db: Session, id: uuid.UUID) -> Faq:
    item = db.get(Faq, id)
    if item is None:
        raise HTTPException(status_code=404, detail="Faq not found")
    return item


@router.get("", response_model=list[AdminFaqDTO])
def list_faqs(db: Database, actor: Coordinator):
    return db.scalars(select(Faq).order_by(Faq.display_order, Faq.id)).all()


@router.post("", response_model=AdminFaqDTO, status_code=201)
def create_faq(data: FaqInputDTO, db: Database, actor: Coordinator):
    values = data.model_dump()
    if values["display_order"] is None:
        last = db.scalar(select(func.max(Faq.display_order)))
        values["display_order"] = 0 if last is None else last + 1
    item = Faq(**values)
    db.add(item)
    db.flush()
    record_audit(
        db, actor_id=actor.id, action=AuditAction.FAQ_CREATE, target_type="faq", target_id=item.id
    )
    db.commit()
    return item


@router.patch("/{id}", response_model=AdminFaqDTO)
def update_faq(id: uuid.UUID, data: FaqPatchDTO, db: Database, actor: Coordinator):
    item = get_item(db, id)
    values = data.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(item, field, value)
    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.FAQ_UPDATE,
        target_type="faq",
        target_id=item.id,
        details={"fields": sorted(values)},
    )
    db.commit()
    return item


@router.delete("/{id}", status_code=204)
def delete_faq(id: uuid.UUID, db: Database, actor: Coordinator) -> Response:
    item = get_item(db, id)
    record_audit(
        db, actor_id=actor.id, action=AuditAction.FAQ_DELETE, target_type="faq", target_id=item.id
    )
    db.delete(item)
    db.commit()
    return Response(status_code=204)
