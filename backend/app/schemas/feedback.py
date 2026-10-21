from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.models.feedback import BODY_MAX_LENGTH


class FeedbackInputDTO(BaseModel):
    """Anonymous Contact-page feedback (TDD 4.7.1). Trimmed before the length check."""

    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BODY_MAX_LENGTH)
    ]
