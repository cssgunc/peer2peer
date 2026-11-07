import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_on_shift
from app.errors import AppError
from app.models import Account
from app.schemas.portal import InboxItemDTO
from app.services.inbox import list_inbox, mark_read

router = APIRouter(prefix="/portal", tags=["portal"])


@router.get("/inbox", response_model=list[InboxItemDTO])
def inbox(
    account: Annotated[Account, Depends(require_on_shift)],
    db: Annotated[Session, Depends(get_db)],
) -> list[InboxItemDTO]:
    return [InboxItemDTO.from_row(row) for row in list_inbox(db, account.id)]


@router.post("/conversations/{conversation_id}/read", status_code=204)
def read(
    conversation_id: uuid.UUID,
    account: Annotated[Account, Depends(require_on_shift)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    # 404 for other responders' conversations too, so ids can't be probed (TDD 4.7.5).
    if mark_read(db, account.id, conversation_id, datetime.now(UTC)) is None:
        raise AppError(404, "conversation_not_found", "Conversation not found.")
    db.commit()
