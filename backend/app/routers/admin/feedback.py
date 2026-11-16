import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.models import Account, FeedbackSubmission
from app.schemas.feedback import FeedbackDTO, UpdateFeedbackDTO
from app.services.audit import AuditAction, record_audit

Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]

router = APIRouter(
    prefix="/admin/feedback",
    tags=["admin"],
    dependencies=[Depends(require_coordinator)],
)


def _to_dto(feedback: FeedbackSubmission) -> FeedbackDTO:
    return FeedbackDTO(
        id=feedback.id,
        body=feedback.body,
        created_on=feedback.created_at.astimezone(UTC).date(),
        read=feedback.read_at is not None,
    )


def _get_feedback(db: Session, feedback_id: uuid.UUID) -> FeedbackSubmission:
    feedback = db.get(FeedbackSubmission, feedback_id)
    if feedback is None:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return feedback


@router.get("", response_model=list[FeedbackDTO])
def list_feedback(db: Database, unread: bool | None = None) -> list[FeedbackDTO]:
    query = select(FeedbackSubmission).order_by(
        FeedbackSubmission.created_at.desc(), FeedbackSubmission.id.desc()
    )
    if unread is True:
        query = query.where(FeedbackSubmission.read_at.is_(None))
    elif unread is False:
        query = query.where(FeedbackSubmission.read_at.is_not(None))
    return [_to_dto(feedback) for feedback in db.scalars(query)]


@router.patch("/{feedback_id}", response_model=FeedbackDTO)
def update_feedback(
    feedback_id: uuid.UUID, payload: UpdateFeedbackDTO, db: Database
) -> FeedbackDTO:
    feedback = _get_feedback(db, feedback_id)
    feedback.read_at = datetime.now(UTC) if payload.read else None
    db.commit()
    return _to_dto(feedback)


@router.delete("/{feedback_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feedback(feedback_id: uuid.UUID, db: Database, coordinator: Coordinator) -> Response:
    feedback = _get_feedback(db, feedback_id)
    record_audit(
        db,
        actor_id=coordinator.id,
        action=AuditAction.FEEDBACK_DELETE,
        target_type="feedback",
        target_id=feedback.id,
    )
    db.delete(feedback)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
