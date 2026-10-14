"""Password hashing and password rules for staff accounts (TDD 4.6.1).

Common password list: the 10,000 most common passwords from SecLists (MIT licensed),
https://github.com/danielmiessler/SecLists/blob/master/Passwords/Common-Credentials/10k-most-common.txt

Never log a password or a hash, and never put either in an exception message.
"""

import secrets
import string
from pathlib import Path

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

MIN_LENGTH = 12
MAX_LENGTH = 128
TEMPORARY_LENGTH = 16
# A shorter local part (like "a" in a@unc.edu) would reject most passwords, so skip the check.
MIN_EMAIL_PART_LENGTH = 3

# Letters and digits, minus characters that look alike when read aloud or copied by hand.
TEMPORARY_ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lI")

_hasher = PasswordHash.recommended()

_COMMON_PASSWORDS = frozenset(
    line.strip().lower()
    for line in (Path(__file__).parent / "common_passwords.txt").read_text().splitlines()
    if line.strip()
)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Return whether `password` matches `password_hash`. A malformed hash never matches."""
    try:
        return _hasher.verify(password, password_hash)
    except UnknownHashError:
        return False


def password_problems(password: str, email: str | None = None) -> list[str]:
    """Return readable reasons `password` isn't allowed, or an empty list if it's fine."""
    problems = []
    if len(password) < MIN_LENGTH:
        problems.append(f"Password must be at least {MIN_LENGTH} characters.")
    elif len(password) > MAX_LENGTH:
        problems.append(f"Password must be at most {MAX_LENGTH} characters.")
    if password.lower() in _COMMON_PASSWORDS:
        problems.append("Password is too common. Choose a less predictable one.")
    if email is not None:
        local_part = email.split("@", 1)[0].lower()
        if len(local_part) >= MIN_EMAIL_PART_LENGTH and local_part in password.lower():
            problems.append("Password can't contain your email address.")
    return problems


def generate_temporary_password() -> str:
    while True:
        password = "".join(secrets.choice(TEMPORARY_ALPHABET) for _ in range(TEMPORARY_LENGTH))
        # A random 16-character string is all but certain to pass; the loop makes it certain.
        if not password_problems(password):
            return password
