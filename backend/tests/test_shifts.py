from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.account import Account, AccountRole
from app.models.shift import Shift, ShiftEndReason
from app.services.shifts import (
    HEARTBEAT_TIMEOUT,
    end_shift,
    get_open_shift,
    is_line_online,
    online_shifts,
    record_heartbeat,
    start_shift,
)


def make_account(email: str = "staff@unc.edu") -> Account:
    return Account(
        email=email,
        display_name="Test staff",
        password_hash="placeholder-not-a-real-password-hash",
        role=AccountRole.RESPONDER,
    )


def make_shift(db) -> Shift:
    account = make_account("test_email@unc.edu")
    db.add(account)
    db.flush()

    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)

    shift = Shift(
        account_id=account.id,
        started_at=now,
        last_heartbeat_at=now,
        ended_at=None,
        ended_reason=None,
    )
    db.add(shift)
    db.flush()
    return shift


def make_shift2(db, account, now) -> Shift:
    db.add(account)
    db.flush()

    shift = Shift(
        account_id=account.id,
        started_at=now,
        last_heartbeat_at=now,
        ended_at=None,
        ended_reason=None,
    )
    db.add(shift)
    db.flush()
    return shift


def test_start_shift_once(db: Session):
    """Creates open shift w/ default start and heartbeat values"""
    # Make Account
    account = make_account("test_email@unc.edu")
    db.add(account)
    db.flush()

    # Make Shift
    now = datetime.now(UTC)
    shift = start_shift(db, account, now)

    assert shift.account_id == account.id
    assert shift.started_at == now
    assert shift.last_heartbeat_at == now
    assert shift.ended_at is None
    assert shift.ended_reason is None

    db.flush()
    saved_shift = db.get(Shift, shift.id)
    assert saved_shift is not None


def test_start_shift_twice(db: Session):
    """Checks that start_shift will return open shift if there already is one"""
    account = make_account("test_email@unc.edu")
    db.add(account)
    db.flush()

    first_now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    second_now = datetime(2026, 1, 1, 12, 5, tzinfo=UTC)
    shift1 = start_shift(db, account, first_now)
    shift2 = start_shift(db, account, second_now)

    assert shift1.id == shift2.id
    assert shift1.last_heartbeat_at == first_now


def test_second_open_shift_for_account_raises(db: Session):
    account = make_account("two_open_shifts@unc.edu")
    db.add(account)
    db.flush()

    first_now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    second_now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)

    first_shift = Shift(
        account_id=account.id,
        started_at=first_now,
        last_heartbeat_at=first_now,
        ended_at=None,
        ended_reason=None,
    )
    db.add(first_shift)
    db.flush()

    second_shift = Shift(
        account_id=account.id,
        started_at=second_now,
        last_heartbeat_at=second_now,
        ended_at=None,
        ended_reason=None,
    )

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(second_shift)
        db.flush()


def test_end_shift(db: Session):
    shift = make_shift(db)
    now = datetime(2026, 1, 1, 12, 15, tzinfo=UTC)

    end_shift(db, shift, ShiftEndReason.SIGNED_OUT, now)
    db.flush()
    db.refresh(shift)

    assert shift.ended_at == now
    assert shift.ended_reason == ShiftEndReason.SIGNED_OUT
    assert shift.last_heartbeat_at == now


def test_get_open_shift_returns_none_for_ended_shift(db: Session):
    """Checks that get_open_shift returns None if there's no open shift"""
    shift = make_shift(db)

    now = datetime(2026, 1, 1, 12, 15, tzinfo=UTC)
    end_shift(db, shift, ShiftEndReason.SIGNED_OUT, now)
    db.flush()
    db.refresh(shift)

    open_shift = get_open_shift(db, shift.account_id)

    assert open_shift is None


def test_get_open_shift_returns_shift_for_active_shift(db: Session):
    """Checks that get_open_shift returns the open shift"""
    shift = make_shift(db)

    open_shift = get_open_shift(db, shift.account_id)

    assert open_shift is not None
    assert open_shift.id == shift.id


def test_record_heartbeat_changed(db: Session):
    """Checks that shift's heartbeat matches the updated heartbeat"""
    new_heartbeat = datetime(2026, 1, 1, 12, 50, tzinfo=UTC)
    shift = make_shift(db)

    record_heartbeat(db, shift, new_heartbeat)
    db.flush()
    db.refresh(shift)

    assert shift.last_heartbeat_at == new_heartbeat


def test_online_shifts(db: Session):
    curr_now = datetime(2026, 1, 1, 12, 6, 31, tzinfo=UTC)

    # Open w/ Fresh Heartbeat --> included
    shift1 = make_shift2(
        db,
        make_account("online_shift_1@unc.edu"),
        curr_now,
    )

    # Open but heartbeat was 91 seconds ago --> excluded
    stale_heartbeat = curr_now - HEARTBEAT_TIMEOUT - timedelta(seconds=1)
    shift2 = make_shift2(
        db,
        make_account("online_shift_2@unc.edu"),
        stale_heartbeat,
    )

    # Open but heartbeat is within 90 seconds --> included
    recent_heartbeat = curr_now - HEARTBEAT_TIMEOUT + timedelta(seconds=10)
    shift3 = make_shift2(
        db,
        make_account("online_shift_3@unc.edu"),
        recent_heartbeat,
    )

    # Ended and has recent heartbeat --> excluded
    shift4 = make_shift2(
        db,
        make_account("online_shift_4@unc.edu"),
        curr_now - timedelta(seconds=10),
    )
    end_shift(db, shift4, ShiftEndReason.SIGNED_OUT, curr_now)
    db.flush()

    online_shift_list = online_shifts(db, curr_now)
    online_ids = {shift.id for shift in online_shift_list}

    assert shift1.id in online_ids
    assert shift2.id not in online_ids
    assert shift3.id in online_ids
    assert shift4.id not in online_ids


def test_is_line_online(db: Session):
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    shift = make_shift(db)

    assert is_line_online(db, now) is True

    end_shift(db, shift, ShiftEndReason.SIGNED_OUT, now)
    db.flush()

    assert is_line_online(db, now) is False
