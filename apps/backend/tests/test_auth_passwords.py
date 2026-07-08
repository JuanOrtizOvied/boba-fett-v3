"""Tests for password hashing (`auth.passwords`).

Covers the "Password Hashing" requirement in
`openspec/specs/user-auth/spec.md`: passwords must be hashed with bcrypt and
plaintext must never be persisted.
"""

from __future__ import annotations


def test_hash_password_returns_bcrypt_hash_not_plaintext():
    from auth.passwords import hash_password

    hashed = hash_password("correct horse battery staple")

    assert hashed != "correct horse battery staple"
    # bcrypt hashes are always prefixed with the algorithm identifier
    assert hashed.startswith("$2b$")


def test_hash_password_produces_different_hashes_for_same_input():
    from auth.passwords import hash_password

    first = hash_password("same-password")
    second = hash_password("same-password")

    # bcrypt salts each hash independently — same input, different output
    assert first != second


def test_verify_password_accepts_correct_password():
    from auth.passwords import hash_password, verify_password

    hashed = hash_password("my-secret-password")

    assert verify_password("my-secret-password", hashed) is True


def test_verify_password_rejects_incorrect_password():
    from auth.passwords import hash_password, verify_password

    hashed = hash_password("my-secret-password")

    assert verify_password("wrong-password", hashed) is False
