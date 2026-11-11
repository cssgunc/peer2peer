import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ReorderDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: Annotated[list[uuid.UUID], Field(min_length=1)]

    @field_validator("ids")
    @classmethod
    def reject_duplicates(cls, ids: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(set(ids)) != len(ids):
            raise ValueError("ids must not contain duplicates")
        return ids
