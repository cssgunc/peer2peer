import uuid

from pydantic import BaseModel


class ReportOptionDTO(BaseModel):
    id: uuid.UUID
    label: str


class ReportOptionsDTO(BaseModel):
    topics: list[ReportOptionDTO]
    outcomes: list[ReportOptionDTO]
