import uuid

from pydantic import BaseModel, ConfigDict

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
