import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.models.report import ReportOptionKind


class ReportOptionDTO(BaseModel):
    id: uuid.UUID
    label: str


class ReportOptionsDTO(BaseModel):
    topics: list[ReportOptionDTO]
    outcomes: list[ReportOptionDTO]


class AdminReportOptionDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: ReportOptionKind
    label: str
    display_order: int
    is_active: bool


class ReportOptionInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ReportOptionKind
    label: Annotated[str, Field(min_length=1, max_length=100)]
    display_order: int
    is_active: bool
