import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_staff
from app.errors import AppError
from app.events import CONVERSATION_UPDATED, portal_topic, publish_after_commit
from app.models import (
    Account,
    Conversation,
    ConversationReport,
    ConversationReportTopic,
    ConversationStatus,
    ReportOption,
    ReportOptionKind,
)
from app.schemas.report import SubmitReportDTO
from app.services.assignment import assign_queued, notify_assigned

# require_staff, not require_on_shift: a responder who just ended their shift still files their
# last report.
router = APIRouter(prefix="/portal/conversations", tags=["portal"])


@router.post("/{id}/report", status_code=201)
def submit_report(
    id: uuid.UUID,
    payload: SubmitReportDTO,
    account: Annotated[Account, Depends(require_staff)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    now = datetime.now(UTC)
    # Locked so concurrent submissions for the same conversation can't both pass the 409 check.
    conversation = db.scalar(
        select(Conversation)
        .where(
            Conversation.id == id,
            Conversation.assigned_account_id == account.id,
            Conversation.status == ConversationStatus.CLOSED,
        )
        .with_for_update()
    )
    if conversation is None:
        raise AppError(404, "conversation_not_found", "Conversation not found.")

    if db.scalar(select(ConversationReport.id).where(ConversationReport.conversation_id == id)):
        raise AppError(
            409, "report_exists", "A report was already submitted for this conversation."
        )

    topic_ids = set(payload.topic_ids)
    active_kinds = {
        option_id: kind
        for option_id, kind in db.execute(
            select(ReportOption.id, ReportOption.kind).where(
                ReportOption.id.in_(topic_ids | {payload.outcome_id}),
                ReportOption.is_active.is_(True),
            )
        )
    }
    if active_kinds.get(payload.outcome_id) != ReportOptionKind.OUTCOME or any(
        active_kinds.get(topic_id) != ReportOptionKind.TOPIC for topic_id in topic_ids
    ):
        raise AppError(422, "invalid_option", "Choose active topics and an active outcome.")

    report = ConversationReport(
        conversation_id=conversation.id,
        account_id=account.id,
        outcome_id=payload.outcome_id,
        confidence=payload.confidence,
        submitted_at=now,
    )
    db.add(report)
    db.flush()
    db.add_all(
        ConversationReportTopic(report_id=report.id, option_id=topic_id) for topic_id in topic_ids
    )
    db.flush()

    # The conversation leaves the responder's inbox once it has a report.
    publish_after_commit(
        db,
        portal_topic(account.id),
        {
            "type": CONVERSATION_UPDATED,
            "data": {"conversation_id": str(conversation.id), "has_report": True},
        },
    )
    # Filing may make the responder eligible again.
    for assigned in assign_queued(db, now):
        assignee = db.get(Account, assigned.assigned_account_id)
        if assignee is not None:
            notify_assigned(db, assigned, assignee)
    db.commit()
