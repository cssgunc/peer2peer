from typing import Literal

from pydantic import AnyHttpUrl, BaseModel


class SiteSettingsDTO(BaseModel):
    tagline: str
    contact_email: str
    instagram_handle: str
    responder_form_url: AnyHttpUrl | None
    sms_number: str | None
    channels: list[Literal["web", "sms"]]
