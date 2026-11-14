from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.errors import AppError
from app.models import Account, SiteSetting
from app.schemas.settings import AdminSiteSettingsDTO, UpdateSiteSettingsDTO
from app.services.audit import AuditAction, record_audit
from app.services.site_settings import SETTINGS, get_setting, set_setting

router = APIRouter(prefix="/admin/settings", tags=["admin settings"])
Database = Annotated[Session, Depends(get_db)]
Coordinator = Annotated[Account, Depends(require_coordinator)]


@router.get("", response_model=list[AdminSiteSettingsDTO])
def get_settings(db: Database, actor: Coordinator) -> list[AdminSiteSettingsDTO]:
    rows = db.scalars(select(SiteSetting)).all()

    rows_by_key = {row.key: row for row in rows}
    updater_ids = {row.updated_by for row in rows if row.updated_by is not None}

    accounts = db.scalars(select(Account).where(Account.id.in_(updater_ids))).all()

    names_by_id = {account.id: account.display_name for account in accounts}

    return [
        AdminSiteSettingsDTO(
            key=key,
            value=get_setting(db, key),
            description=definition.description,
            public=definition.public,
            updated_by=(
                names_by_id.get(rows_by_key[key].updated_by)
                if key in rows_by_key and rows_by_key[key].updated_by is not None
                else None
            ),
            updated_at=rows_by_key[key].updated_at if key in rows_by_key else None,
        )
        for key, definition in SETTINGS.items()
    ]


@router.put("/{key}", response_model=AdminSiteSettingsDTO, status_code=200)
def update_setting(
    key: str, new_value: UpdateSiteSettingsDTO, db: Database, actor: Coordinator
) -> AdminSiteSettingsDTO:
    if key not in SETTINGS:
        raise HTTPException(status_code=404, detail="Unknown setting")

    try:
        updated_value = set_setting(db, key, new_value.value, actor.id)
    except ValidationError:
        raise AppError(422, "validation_error", f"Invalid value for setting '{key}'") from None

    row = db.get(SiteSetting, key)
    assert row is not None

    record_audit(
        db,
        actor_id=actor.id,
        action=AuditAction.SETTINGS_UPDATE,
        target_type="setting",
        details={"key": key},
    )
    db.commit()

    return AdminSiteSettingsDTO(
        key=key,
        value=updated_value,
        description=SETTINGS[key].description,
        public=SETTINGS[key].public,
        updated_by=actor.display_name,
        updated_at=row.updated_at,
    )
