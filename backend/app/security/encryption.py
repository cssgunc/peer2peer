"""AES-GCM encryption for fields stored at rest, like message bodies and escalations (TDD 4.6.7).

Each purpose has its own versioned keys, so a leaked message key can't read escalations.
Ciphertext is stored as nonce + ciphertext + tag in one column, next to the key version.
Never log or put plaintext or keys in exception messages.
"""

import base64
import os
from enum import StrEnum

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

NONCE_BYTES = 12


class KeyPurpose(StrEnum):
    MESSAGE = "message"
    ESCALATION = "escalation"


def _keys(purpose: KeyPurpose) -> dict[int, str]:
    settings = get_settings()
    match purpose:
        case KeyPurpose.MESSAGE:
            return settings.message_keys
        case KeyPurpose.ESCALATION:
            return settings.escalation_keys


def _aesgcm(purpose: KeyPurpose, key_version: int) -> AESGCM:
    key = _keys(purpose).get(key_version)
    if key is None:
        raise ValueError(f"unknown {purpose} key version {key_version}")
    return AESGCM(base64.b64decode(key))


def _associated_data(purpose: KeyPurpose, key_version: int) -> bytes:
    # Binds ciphertext to its purpose and version, so it fails to decrypt under any other
    # even if two mappings were misconfigured with the same key.
    return f"{purpose}:{key_version}".encode()


def encrypt(plaintext: str, purpose: KeyPurpose) -> tuple[bytes, int]:
    """Encrypt with the newest key for `purpose`. Return (nonce + ciphertext, key version)."""
    key_version = max(_keys(purpose))
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = _aesgcm(purpose, key_version).encrypt(
        nonce, plaintext.encode(), _associated_data(purpose, key_version)
    )
    return nonce + ciphertext, key_version


def decrypt(ciphertext: bytes, key_version: int, purpose: KeyPurpose) -> str:
    """Decrypt output of `encrypt`. Raises `cryptography.exceptions.InvalidTag` if tampered."""
    nonce, body = ciphertext[:NONCE_BYTES], ciphertext[NONCE_BYTES:]
    plaintext = _aesgcm(purpose, key_version).decrypt(
        nonce, body, _associated_data(purpose, key_version)
    )
    return plaintext.decode()
