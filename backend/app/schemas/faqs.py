import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FaqDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category: str
    question: str
    answer_md: str


class AdminFaqDTO(FaqDTO):
    display_order: int
    is_published: bool


class FaqInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Annotated[str, Field(min_length=1, max_length=100)]
    question: Annotated[str, Field(min_length=1, max_length=300)]
    answer_md: Annotated[str, Field(min_length=1)]
    display_order: int | None = None
    is_published: bool = False


class FaqPatchDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    question: Annotated[str, Field(min_length=1, max_length=300)] | None = None
    answer_md: Annotated[str, Field(min_length=1)] | None = None
    display_order: int | None = None
    is_published: bool | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> FaqPatchDTO:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self
