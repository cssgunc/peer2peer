import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr

from app.models import AccountRole


def normalize_email(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


NormalizedEmail = Annotated[EmailStr, BeforeValidator(normalize_email)]


class SignInDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    password: str


class ShiftDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    started_at: datetime


class MeDTO(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    role: AccountRole
    must_change_password: bool
    shift: ShiftDTO | None
