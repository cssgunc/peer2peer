import uuid

from pydantic import BaseModel, ConfigDict


class ResourceDTO(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    url: str | None
    phone: str | None
    is_unc: bool
    is_crisis: bool
    tags: list[str]


class ResourceTagDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
