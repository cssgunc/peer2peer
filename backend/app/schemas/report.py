import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class ReportOptionPatchDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ReportOptionKind | None = None
    label: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    display_order: int | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> ReportOptionPatchDTO:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self
