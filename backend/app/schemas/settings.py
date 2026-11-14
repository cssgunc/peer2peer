from datetime import datetime
from typing import Any, Literal

from pydantic import AnyHttpUrl, BaseModel


class SiteSettingsDTO(BaseModel):
    tagline: str
    contact_email: str
    instagram_handle: str
    responder_form_url: AnyHttpUrl | None
    sms_number: str | None
    channels: list[Literal["web", "sms"]]


class AdminSiteSettingsDTO(BaseModel):
    key: str
    value: Any
    description: str
    public: bool
    updated_by: str | None
    updated_at: datetime | None


class UpdateSiteSettingsDTO(BaseModel):
    value: Any
