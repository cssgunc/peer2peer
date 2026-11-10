import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, EmailStr, StringConstraints

from app.models import AccountRole


class AccountDTO(BaseModel):
    """Staff account as coordinators see it (TDD 4.7.1). Never includes the password hash."""

    id: uuid.UUID
    email: str
    display_name: str
    role: AccountRole
    is_active: bool
    last_login_at: datetime | None
    on_shift: bool


class CreatedAccountDTO(AccountDTO):
    # The only place the temporary password ever appears: it is never stored, logged, or audited.
    temporary_password: str


class CreateAccountDTO(BaseModel):
    email: EmailStr
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    role: AccountRole


class UpdateAccountDTO(BaseModel):
    """Any omitted (or null) field is left as it is."""

    display_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
        | None
    ) = None
    role: AccountRole | None = None
    is_active: bool | None = None


class TemporaryPasswordDTO(BaseModel):
    # Shown once to the coordinator; never stored, logged, or audited.
    temporary_password: str
