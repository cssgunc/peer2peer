import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StatisticDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    value: str


class AdminStatisticDTO(StatisticDTO):
    display_order: int
    is_published: bool


class StatisticInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: Annotated[str, Field(min_length=1, max_length=200)]
    value: Annotated[str, Field(min_length=1, max_length=50)]
    display_order: int | None = None
    is_published: bool = False


class StatisticPatchDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    value: Annotated[str, Field(min_length=1, max_length=50)] | None = None
    display_order: int | None = None
    is_published: bool | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> StatisticPatchDTO:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self
