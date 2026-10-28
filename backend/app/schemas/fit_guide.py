import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.fit_guide import Fit

GuideText = Annotated[str, Field(min_length=1, max_length=300)]


class FitGuideResourceDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    url: str | None
    phone: str | None


class FitGuideItemDTO(BaseModel):
    id: uuid.UUID
    text: str
    resource_id: uuid.UUID | None
    resource: FitGuideResourceDTO | None


class FitGuideDTO(BaseModel):
    good_fit: list[FitGuideItemDTO]
    other_resource: list[FitGuideItemDTO]


class AdminFitGuideItemDTO(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    fit: Fit
    text: str
    resource_id: uuid.UUID | None
    display_order: int


class FitGuideItemInputDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fit: Fit
    text: GuideText
    resource_id: uuid.UUID | None = None
    display_order: int


class FitGuideItemPatchDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fit: Fit | None = None
    text: GuideText | None = None
    resource_id: uuid.UUID | None = None
    display_order: int | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> FitGuideItemPatchDTO:
        for name in self.model_fields_set - {"resource_id"}:
            if getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self
