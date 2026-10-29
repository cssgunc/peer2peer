import uuid
from copy import deepcopy
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import AnyHttpUrl, AwareDatetime, EmailStr, Field, TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from app.models.site_setting import SiteSetting
from app.seed import register


@register
def seed_site_settings(db: Session) -> None:
    set_setting(db, "tagline", "Someone to talk to, by students for students.", None)
    set_setting(db, "responder_form_url", "https://example.com/responder-form", None)


@dataclass(frozen=True)
class SettingDef:
    adapter: TypeAdapter[Any]
    default: Any
    public: bool
    description: str


def _def(tp: Any, default: Any, description: str, *, public: bool = True) -> SettingDef:
    return SettingDef(TypeAdapter(tp), default, public, description)


SETTINGS: dict[str, SettingDef] = {
    "tagline": _def(Annotated[str, Field(max_length=200)], "", "Short tagline on the home page."),
    "contact_email": _def(EmailStr, "peer2peernc@unc.edu", "Public contact email."),
    "instagram_handle": _def(str, "uncpeer2peer", "Instagram handle, without the @."),
    "responder_form_url": _def(AnyHttpUrl | None, None, "Link to the responder application form."),
    "sms_number": _def(str | None, None, "Text line number, if SMS is enabled."),
    "channels": _def(list[Literal["web", "sms"]], ["web"], "Which channels the line accepts."),
    "line_launch_at": _def(
        AwareDatetime | None,
        None,
        "When the line launches. Served by the status endpoint, not here.",
        public=False,
    ),
    "after_hours_behavior": _def(
        Literal["close", "queue"],
        "close",
        "After the after-hours reply: close the conversation, or keep it queued for the next shift",
        public=False,
    ),
}


def get_setting(db: Session, key: str) -> Any:
    """Stored value if valid, otherwise the default. Unknown keys raise KeyError."""
    definition = SETTINGS[key]
    row = db.get(SiteSetting, key)
    if row is None:
        return deepcopy(definition.default)
    try:
        return definition.adapter.validate_python(row.value)
    except ValidationError:
        return deepcopy(definition.default)


def set_setting(db: Session, key: str, value: Any, actor_id: uuid.UUID | None) -> Any:
    """Validate and upsert. Raises pydantic ValidationError on bad values."""
    definition = SETTINGS[key]
    validated = definition.adapter.validate_python(value)
    stored = definition.adapter.dump_python(validated, mode="json")

    row = db.get(SiteSetting, key)
    if row is None:
        db.add(SiteSetting(key=key, value=stored, updated_by=actor_id))
    else:
        row.value = stored
        row.updated_by = actor_id
    db.flush()
    return validated
