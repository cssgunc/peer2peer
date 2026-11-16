from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class ContentBlockDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    title: str
    body_md: str
    updated_at: datetime | None


class UpdateContentBlockDTO(BaseModel):
    title: str
    body_md: Annotated[str, Field(max_length=20_000)]
