import pytest

from app.security.passwords import (
    MAX_LENGTH,
    TEMPORARY_LENGTH,
    generate_temporary_password,
    hash_password,
    password_problems,
    verify_password,
)

GOOD_PASSWORD = "correct horse battery"


def test_hash_then_verify() -> None:
    password_hash = hash_password(GOOD_PASSWORD)

    assert password_hash.startswith("$argon2id$")
    assert GOOD_PASSWORD not in password_hash
    assert verify_password(GOOD_PASSWORD, password_hash)
    assert not verify_password("correct horse battery!", password_hash)


def test_same_password_hashes_differently() -> None:
    assert hash_password(GOOD_PASSWORD) != hash_password(GOOD_PASSWORD)


def test_malformed_hash_does_not_verify() -> None:
    assert not verify_password(GOOD_PASSWORD, "not a hash")


def test_good_password_has_no_problems() -> None:
    assert password_problems(GOOD_PASSWORD, "jdoe@unc.edu") == []


@pytest.mark.parametrize("password", ["a" * 12, "a" * MAX_LENGTH])
def test_length_boundaries_pass(password: str) -> None:
    assert password_problems(password) == []


def test_11_character_password_fails() -> None:
    assert password_problems("abcdefghijk") == ["Password must be at least 12 characters."]


def test_too_long_password_fails() -> None:
    assert password_problems("a" * (MAX_LENGTH + 1)) == [
        f"Password must be at most {MAX_LENGTH} characters."
    ]


@pytest.mark.parametrize("password", ["unbelievable", "UnBelievable", "UNBELIEVABLE"])
def test_common_password_fails_in_any_case(password: str) -> None:
    # "unbelievable" is on the list and 12 characters, so only the common-list rule applies.
    assert password_problems(password) == ["Password is too common. Choose a less predictable one."]


@pytest.mark.parametrize("email", ["jdoe@unc.edu", "JDoe@UNC.edu"])
def test_password_containing_email_local_part_fails(email: str) -> None:
    assert password_problems("my-JDOE-password", email) == [
        "Password can't contain your email address."
    ]


def test_very_short_email_local_part_is_ignored() -> None:
    assert password_problems(GOOD_PASSWORD, "a@unc.edu") == []


def test_temporary_passwords_pass_rules_and_are_unique() -> None:
    passwords = [generate_temporary_password() for _ in range(100)]

    assert len(set(passwords)) == 100
    for password in passwords:
        assert len(password) == TEMPORARY_LENGTH
        assert password_problems(password) == []
        assert not set(password) & set("0O1lI")
