"""Password hashing for SABBI user accounts.

Uses bcrypt (see `openspec/changes/sabbi-auth/design.md` — "Password
hashing" decision). Plaintext passwords are never persisted or logged;
only `hash_password()` output is stored in `users.password_hash`
(`user-auth/spec.md` — "Password Hashing" requirement).
"""

from __future__ import annotations

import os

import bcrypt

BCRYPT_ROUNDS = int(os.environ.get("BCRYPT_ROUNDS", "10"))


def hash_password(plain_password: str) -> str:
    salt = bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compare a plaintext password against a stored bcrypt hash."""
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )
