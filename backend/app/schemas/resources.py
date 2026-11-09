import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator


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


class ResourceInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(min_length=1, max_length=1000)]
    url: Annotated[str, Field(max_length=500, pattern=r"^https?://")] | None = None
    phone: Annotated[str, Field(min_length=1, max_length=50)] | None = None
    is_unc: bool = False
    is_crisis: bool = False
    is_published: bool = False
    display_order: int = 0
    tag_ids: list[uuid.UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_contact(self) -> ResourceInputDTO:
        if not self.url and not self.phone:
            raise ValueError("A resource needs a URL or phone number")
        return self


class ResourcePatchDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    description: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    url: Annotated[str, Field(max_length=500, pattern=r"^https?://")] | None = None
    phone: Annotated[str, Field(min_length=1, max_length=50)] | None = None
    is_unc: bool | None = None
    is_crisis: bool | None = None
    is_published: bool | None = None
    display_order: int | None = None
    tag_ids: list[uuid.UUID] | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> ResourcePatchDTO:
        for name in self.model_fields_set - {"url", "phone"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class ResourceTagInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: Annotated[str, Field(min_length=1, max_length=100)]
    display_order: int = 0


class ResourceTagPatchDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    display_order: int | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> ResourceTagPatchDTO:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class AdminResourceTagDTO(ResourceTagDTO):
    display_order: int


class AdminResourceDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    url: str | None
    phone: str | None
    is_unc: bool
    is_crisis: bool
    is_published: bool
    display_order: int
    tags: list[AdminResourceTagDTO]
