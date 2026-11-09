"""Coordinator account management: list, create, update, reset password (TDD 4.3.3, 4.7.6).

There's no DELETE route: accounts are deactivated, not deleted, so reports keep their author.
Never log or audit a temporary password.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies.auth import require_coordinator
from app.errors import AppError
from app.models import Account, AccountRole, Shift
from app.models.shift import ShiftEndReason
from app.schemas.accounts import (
    AccountDTO,
    CreateAccountDTO,
    CreatedAccountDTO,
    TemporaryPasswordDTO,
    UpdateAccountDTO,
)
from app.security.passwords import generate_temporary_password, hash_password
from app.services.audit import AuditAction, record_audit
from app.services.sessions import revoke_all_sessions
from app.services.shifts import end_shift_and_requeue, get_open_shift

router = APIRouter(
    prefix="/admin/accounts",
    tags=["admin"],
    dependencies=[Depends(require_coordinator)],
)

# True when the account has a shift that hasn't ended.
_has_open_shift = (
    exists().where(Shift.account_id == Account.id, Shift.ended_at.is_(None)).correlate(Account)
)


def _to_dto(account: Account, on_shift: bool) -> AccountDTO:
    return AccountDTO(
        id=account.id,
        email=account.email,
        display_name=account.display_name,
        role=account.role,
        is_active=account.is_active,
        last_login_at=account.last_login_at,
        on_shift=on_shift,
    )


def _check_email_domain(email: str) -> None:
    allowed = {d.strip().lower().lstrip("@") for d in get_settings().staff_email_domains}
    if allowed and email.rsplit("@", 1)[1].lower() not in allowed:
        raise AppError(
            422, "email_domain_not_allowed", "Staff accounts must use an allowed email domain."
        )


def _email_taken(db: Session, email: str) -> bool:
    # email is CITEXT, so this match ignores case.
    return bool(db.scalar(select(exists().where(Account.email == email))))


@router.get("", response_model=list[AccountDTO])
def list_accounts(
    db: Annotated[Session, Depends(get_db)],
    role: AccountRole | None = None,
    is_active: bool | None = None,
) -> list[AccountDTO]:
    query = select(Account, _has_open_shift.label("on_shift")).order_by(
        func.lower(Account.display_name), Account.email
    )
    if role is not None:
        query = query.where(Account.role == role)
    if is_active is not None:
        query = query.where(Account.is_active == is_active)
    return [_to_dto(account, on_shift) for account, on_shift in db.execute(query)]


@router.post("", response_model=CreatedAccountDTO, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: CreateAccountDTO,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    coordinator: Annotated[Account, Depends(require_coordinator)],
) -> CreatedAccountDTO:
    _check_email_domain(payload.email)
    if _email_taken(db, payload.email):
        raise AppError(409, "email_taken", "An account with this email already exists.")

    temporary_password = generate_temporary_password()
    account = Account(
        email=payload.email,
        display_name=payload.display_name,
        password_hash=hash_password(temporary_password),
        role=payload.role,
        must_change_password=True,
    )
    db.add(account)
    try:
        db.flush()
    except IntegrityError:
        # Another request created the same email between the check and the insert.
        db.rollback()
        raise AppError(409, "email_taken", "An account with this email already exists.") from None

    record_audit(
        db,
        actor_id=coordinator.id,
        action=AuditAction.ACCOUNT_CREATE,
        target_type="account",
        target_id=account.id,
        details={"role": account.role.value},
    )
    db.commit()

    # The body holds a password, so browsers and proxies must not keep a copy.
    response.headers["Cache-Control"] = "no-store"
    return CreatedAccountDTO(
        **_to_dto(account, on_shift=False).model_dump(),
        temporary_password=temporary_password,
    )


def _get_for_update(db: Session, account_id: uuid.UUID) -> Account:
    account = db.scalar(select(Account).where(Account.id == account_id).with_for_update())
    if account is None:
        raise AppError(404, "not_found", "Account not found.")
    return account


def _check_coordinator_guards(
    db: Session, coordinator: Account, account: Account, payload: UpdateAccountDTO
) -> None:
    deactivating = payload.is_active is False and account.is_active
    demoting = payload.role == AccountRole.RESPONDER and account.role == AccountRole.COORDINATOR
    if not (deactivating or demoting):
        return
    if account.id == coordinator.id:
        raise AppError(
            422,
            "cannot_change_own_access",
            "You can't deactivate or demote your own account.",
        )
    if account.role == AccountRole.COORDINATOR and account.is_active:
        # Lock every active coordinator so two concurrent demotions can't both pass.
        active_coordinators = db.scalars(
            select(Account.id)
            .where(Account.role == AccountRole.COORDINATOR, Account.is_active.is_(True))
            .with_for_update()
        ).all()
        if len(active_coordinators) <= 1:
            raise AppError(
                422,
                "last_coordinator",
                "The last active coordinator can't be deactivated or demoted.",
            )


@router.patch("/{account_id}", response_model=AccountDTO)
def update_account(
    account_id: uuid.UUID,
    payload: UpdateAccountDTO,
    db: Annotated[Session, Depends(get_db)],
    coordinator: Annotated[Account, Depends(require_coordinator)],
) -> AccountDTO:
    account = _get_for_update(db, account_id)
    _check_coordinator_guards(db, coordinator, account, payload)

    changed: list[str] = []
    if payload.display_name is not None and payload.display_name != account.display_name:
        account.display_name = payload.display_name
        changed.append("display_name")
    if payload.role is not None and payload.role != account.role:
        account.role = payload.role
        changed.append("role")

    deactivated = False
    if payload.is_active is not None and payload.is_active != account.is_active:
        account.is_active = payload.is_active
        if payload.is_active:
            # Reactivating only flips the flag; the person signs in again on their own.
            changed.append("is_active")
        else:
            deactivated = True
            now = datetime.now(UTC)
            revoke_all_sessions(db, account.id, now)
            end_shift_and_requeue(db, account, ShiftEndReason.DEACTIVATED, now)

    if changed:
        record_audit(
            db,
            actor_id=coordinator.id,
            action=AuditAction.ACCOUNT_UPDATE,
            target_type="account",
            target_id=account.id,
            details={"fields": changed},
        )
    if deactivated:
        record_audit(
            db,
            actor_id=coordinator.id,
            action=AuditAction.ACCOUNT_DEACTIVATE,
            target_type="account",
            target_id=account.id,
        )
    db.flush()
    on_shift = get_open_shift(db, account.id) is not None
    db.commit()
    return _to_dto(account, on_shift=on_shift)


@router.post("/{account_id}/reset-password", response_model=TemporaryPasswordDTO)
def reset_password(
    account_id: uuid.UUID,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    coordinator: Annotated[Account, Depends(require_coordinator)],
) -> TemporaryPasswordDTO:
    account = _get_for_update(db, account_id)

    temporary_password = generate_temporary_password()
    account.password_hash = hash_password(temporary_password)
    account.must_change_password = True
    revoke_all_sessions(db, account.id, datetime.now(UTC))
    record_audit(
        db,
        actor_id=coordinator.id,
        action=AuditAction.ACCOUNT_RESET_PASSWORD,
        target_type="account",
        target_id=account.id,
    )
    db.commit()

    # The body holds a password, so browsers and proxies must not keep a copy.
    response.headers["Cache-Control"] = "no-store"
    return TemporaryPasswordDTO(temporary_password=temporary_password)
