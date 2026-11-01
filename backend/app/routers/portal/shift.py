from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_staff
from app.models import Account
from app.models.shift import ShiftEndReason
from app.schemas.auth import ShiftDTO
from app.services.assignment import assign_queued, notify_assigned
from app.services.shifts import end_shift_and_requeue, record_heartbeat, start_shift

# require_staff, not require_on_shift: starting a shift has to work while off one.
router = APIRouter(prefix="/portal/shift", tags=["portal"])


@router.post("/start", response_model=ShiftDTO)
def start(
    account: Annotated[Account, Depends(require_staff)], db: Annotated[Session, Depends(get_db)]
) -> ShiftDTO:
    now = datetime.now(UTC)
    shift = start_shift(db, account, now)
    # Starting again counts as a heartbeat, or a stale shift would get no assignments.
    record_heartbeat(db, shift, now)
    for conversation in assign_queued(db, now):
        # Usually this account, but another on-shift responder may have a lighter load.
        assignee = db.get(Account, conversation.assigned_account_id)
        if assignee is not None:
            notify_assigned(db, conversation, assignee)
    result = ShiftDTO.model_validate(shift)
    db.commit()
    return result


@router.post("/end", status_code=204)
def end(
    account: Annotated[Account, Depends(require_staff)], db: Annotated[Session, Depends(get_db)]
) -> None:
    end_shift_and_requeue(db, account, ShiftEndReason.MANUAL, datetime.now(UTC))
    db.commit()
