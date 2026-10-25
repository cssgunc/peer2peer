from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.settings import SiteSettingsDTO
from app.services.site_settings import SETTINGS, get_setting

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SiteSettingsDTO)
def read_settings(db: Annotated[Session, Depends(get_db)]) -> SiteSettingsDTO:
    values = {key: get_setting(db, key) for key, d in SETTINGS.items() if d.public}
    return SiteSettingsDTO(**values)
