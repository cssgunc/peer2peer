"""Coordinator account management: list and create (TDD 4.3.3, 4.7.6).

There's no DELETE route: accounts are deactivated, not deleted, so reports keep their author.
Never log or audit a temporary password.
"""

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
from app.schemas.accounts import AccountDTO, CreateAccountDTO, CreatedAccountDTO
from app.security.passwords import generate_temporary_password, hash_password
from app.services.audit import AuditAction, record_audit

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
