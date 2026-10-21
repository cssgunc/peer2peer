from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ContentBlockDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    title: str
    body_md: str
    updated_at: datetime | None
