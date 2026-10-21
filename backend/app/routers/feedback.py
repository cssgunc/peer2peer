from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FeedbackSubmission
from app.models.feedback import start_of_utc_day
from app.schemas.feedback import FeedbackInputDTO
from app.security.rate_limit import rate_limit

# Per sender: enough for a typo fix or two, not enough to flood the inbox.
PER_IP_LIMIT = 3
PER_IP_WINDOW_SECONDS = 10 * 60
# Across everyone, so a script rotating IPs still can't bury the coordinator inbox.
GLOBAL_LIMIT = 200
GLOBAL_WINDOW_SECONDS = 60 * 60
GLOBAL_KEY = "all"

router = APIRouter(tags=["feedback"])


@router.post(
    "/feedback",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[
        # Per-IP first, so one sender's blocked retries never use up the shared cap.
        Depends(rate_limit("feedback", PER_IP_LIMIT, PER_IP_WINDOW_SECONDS)),
        Depends(
            rate_limit(
                "feedback-global",
                GLOBAL_LIMIT,
                GLOBAL_WINDOW_SECONDS,
                key=lambda _request: GLOBAL_KEY,
            )
        ),
    ],
)
def submit_feedback(payload: FeedbackInputDTO, db: Annotated[Session, Depends(get_db)]) -> None:
    # Store only the body and the day. Never log the body or echo it back (TDD 4.5.3).
    db.add(FeedbackSubmission(body=payload.body, created_at=start_of_utc_day()))
    db.commit()
