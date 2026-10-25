import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.services.site_settings import get_setting, set_setting


def test_defaults_when_nothing_stored(db: Session) -> None:
    assert get_setting(db, "contact_email") == "peer2peernc@unc.edu"
    assert get_setting(db, "channels") == ["web"]
    assert get_setting(db, "responder_form_url") is None


def test_stored_value_wins(db: Session) -> None:
    set_setting(db, "tagline", "Talk to a peer", None)
    assert get_setting(db, "tagline") == "Talk to a peer"


def test_unknown_key_raises(db: Session) -> None:
    with pytest.raises(KeyError):
        get_setting(db, "nope")


def test_set_rejects_bad_email(db: Session) -> None:
    with pytest.raises(ValidationError):
        set_setting(db, "contact_email", "not-an-email", None)


def test_set_rejects_non_url(db: Session) -> None:
    with pytest.raises(ValidationError):
        set_setting(db, "responder_form_url", "not a url", None)


def test_non_public_keys_not_served(db: Session, client: TestClient) -> None:
    set_setting(db, "line_launch_at", "2026-11-01T00:00:00Z", None)
    body = client.get("/api/settings").json()
    assert "line_launch_at" not in body
    assert body["contact_email"] == "peer2peernc@unc.edu"


def test_launch_date_requires_timezone(db: Session) -> None:
    with pytest.raises(ValidationError):
        set_setting(db, "line_launch_at", "2026-11-01T00:00:00", None)
