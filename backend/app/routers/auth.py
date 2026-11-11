import math
import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_account, get_current_session
from app.errors import AppError
from app.models import Account, AuthSession
from app.models.shift import ShiftEndReason
from app.schemas.auth import ChangePasswordDTO, MeDTO, ShiftDTO, SignInDTO
from app.security.passwords import hash_password, password_problems, verify_password
from app.security.rate_limit import limiter, rate_limit
from app.services.sessions import (
    clear_session_cookie,
    issue_session,
    revoke_all_sessions,
    revoke_session,
    set_session_cookie,
)
from app.services.shifts import end_shift_and_requeue, get_open_shift

router = APIRouter(prefix="/auth", tags=["auth"])
WINDOW_SECONDS = 15 * 60
# Pay the hashing cost once, then do one verification for every allowed sign-in attempt.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


def _me(db: Session, account: Account) -> MeDTO:
    shift = get_open_shift(db, account.id)
    return MeDTO(
        id=account.id,
        email=account.email,
        display_name=account.display_name,
        role=account.role,
        must_change_password=account.must_change_password,
        shift=ShiftDTO.model_validate(shift) if shift is not None else None,
    )


@router.post(
    "/sign-in",
    response_model=MeDTO,
    dependencies=[Depends(rate_limit("sign-in-ip", 20, WINDOW_SECONDS))],
)
def sign_in(
    payload: SignInDTO, response: Response, db: Annotated[Session, Depends(get_db)]
) -> MeDTO:
    retry_after = limiter.hit(f"sign-in-email:{payload.email}", 5, WINDOW_SECONDS)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Try again later.",
            headers={"Retry-After": str(math.ceil(retry_after))},
        )

    account = db.scalar(select(Account).where(Account.email == payload.email))
    password_matches = verify_password(
        payload.password, account.password_hash if account is not None else _DUMMY_HASH
    )
    if account is None or not password_matches or not account.is_active:
        raise AppError(401, "invalid_credentials", "Invalid email or password.")

    now = datetime.now(UTC)
    token = issue_session(db, account, now)
    account.last_login_at = now
    result = _me(db, account)
    db.commit()
    set_session_cookie(response, token)
    return result


@router.post("/sign-out", status_code=204)
def sign_out(
    response: Response,
    session: Annotated[AuthSession, Depends(get_current_session)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    now = datetime.now(UTC)
    revoke_session(db, session, now)
    account = db.get(Account, session.account_id)
    if account is not None:
        end_shift_and_requeue(db, account, ShiftEndReason.SIGNED_OUT, now)
    db.commit()
    clear_session_cookie(response)


@router.get("/me", response_model=MeDTO)
def me(
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[Session, Depends(get_db)],
) -> MeDTO:
    return _me(db, account)


@router.post("/password", status_code=204)
def change_password(
    payload: ChangePasswordDTO,
    session: Annotated[AuthSession, Depends(get_current_session)],
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    # Keyed by account, so someone at an unlocked computer can't guess the current password.
    retry_after = limiter.hit(f"change-password:{account.id}", 5, WINDOW_SECONDS)
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Try again later.",
            headers={"Retry-After": str(math.ceil(retry_after))},
        )

    if not verify_password(payload.current_password, account.password_hash):
        raise AppError(400, "wrong_password", "Current password is incorrect.")
    problems = password_problems(payload.new_password, account.email)
    if payload.new_password == payload.current_password:
        # Otherwise a flagged account could keep the temporary password a coordinator has seen.
        problems.append("New password must be different from your current password.")
    if problems:
        raise AppError(422, "weak_password", " ".join(problems))

    account.password_hash = hash_password(payload.new_password)
    account.must_change_password = False
    # The old password may have leaked, so end every session except the one making this change.
    revoke_all_sessions(db, account.id, datetime.now(UTC), except_session_id=session.id)
    db.commit()
