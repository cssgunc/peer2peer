import base64
import binascii
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

KEY_BYTES = 32


class Settings(BaseSettings):
    # hide_input_in_errors keeps encryption keys out of validation error messages.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    database_url: str = "postgresql+psycopg://postgres:postgres@db:5432/peer2peer"
    test_database_url: str = "postgresql+psycopg://postgres:postgres@db:5432/peer2peer_test"
    cors_origins: list[str] = ["http://localhost:3000"]
    line_timezone: str = "America/New_York"

    # Key version -> base64-encoded 32-byte AES key (TDD 4.6.7). The highest version encrypts.
    message_keys: dict[int, str]
    escalation_keys: dict[int, str]

    @field_validator("message_keys", "escalation_keys")
    @classmethod
    def _check_keys(cls, keys: dict[int, str]) -> dict[int, str]:
        # Error messages name only the version, never the key itself.
        if not keys:
            raise ValueError("at least one key version is required")
        for version, key in keys.items():
            try:
                decoded = base64.b64decode(key, validate=True)
            except binascii.Error:
                raise ValueError(f"key version {version} is not valid base64") from None
            if len(decoded) != KEY_BYTES:
                raise ValueError(f"key version {version} must decode to {KEY_BYTES} bytes")
        return keys


@lru_cache
def get_settings() -> Settings:
    return Settings()
