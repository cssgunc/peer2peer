import base64
import json
import os

import pytest
from cryptography.exceptions import InvalidTag
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.security.encryption import KeyPurpose, decrypt, encrypt


def _new_key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


@pytest.mark.parametrize("plaintext", ["hello", "I'm okay 🙂💙", "a" * 2000, ""])
def test_round_trip(plaintext: str) -> None:
    ciphertext, version = encrypt(plaintext, KeyPurpose.MESSAGE)
    assert decrypt(ciphertext, version, KeyPurpose.MESSAGE) == plaintext


def test_same_plaintext_gives_different_ciphertext() -> None:
    first, _ = encrypt("same text", KeyPurpose.MESSAGE)
    second, _ = encrypt("same text", KeyPurpose.MESSAGE)
    assert first != second


def test_tampered_ciphertext_raises() -> None:
    ciphertext, version = encrypt("hello", KeyPurpose.MESSAGE)
    tampered = bytearray(ciphertext)
    tampered[-1] ^= 0x01
    with pytest.raises(InvalidTag):
        decrypt(bytes(tampered), version, KeyPurpose.MESSAGE)


def test_message_key_cannot_decrypt_escalation() -> None:
    ciphertext, version = encrypt("hello", KeyPurpose.ESCALATION)
    with pytest.raises(InvalidTag):
        decrypt(ciphertext, version, KeyPurpose.MESSAGE)


def test_new_key_version_encrypts_and_old_still_decrypts(monkeypatch: pytest.MonkeyPatch) -> None:
    keys = get_settings().message_keys
    old_version = max(keys)
    old_ciphertext, used = encrypt("before rotation", KeyPurpose.MESSAGE)
    assert used == old_version

    monkeypatch.setitem(keys, old_version + 1, _new_key())
    new_ciphertext, used = encrypt("after rotation", KeyPurpose.MESSAGE)

    assert used == old_version + 1
    assert decrypt(new_ciphertext, used, KeyPurpose.MESSAGE) == "after rotation"
    assert decrypt(old_ciphertext, old_version, KeyPurpose.MESSAGE) == "before rotation"


def test_unknown_key_version_raises() -> None:
    ciphertext, version = encrypt("hello", KeyPurpose.MESSAGE)
    with pytest.raises(ValueError, match="unknown"):
        decrypt(ciphertext, version + 100, KeyPurpose.MESSAGE)


@pytest.mark.parametrize(
    "keys",
    [
        {},
        {1: base64.b64encode(os.urandom(16)).decode()},
        {1: "not base64!"},
    ],
)
def test_settings_reject_bad_keys(keys: dict[int, str], monkeypatch: pytest.MonkeyPatch) -> None:
    # Set via env, not init kwargs: pydantic-settings merges dict values across sources.
    monkeypatch.setenv("MESSAGE_KEYS", json.dumps(keys))
    monkeypatch.setenv("ESCALATION_KEYS", json.dumps({1: _new_key()}))
    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None)
    assert [error["loc"] for error in excinfo.value.errors()] == [("message_keys",)]
    for key in keys.values():
        assert key not in str(excinfo.value)
