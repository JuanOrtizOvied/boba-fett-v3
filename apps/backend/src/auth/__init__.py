"""Authentication module: password hashing, JWT tokens, and models."""

from __future__ import annotations

from auth.models import LoginRequest, UserCreate, UserResponse
from auth.passwords import hash_password, verify_password
from auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    hash_refresh_token,
)

__all__ = [
    "hash_password",
    "verify_password",
    "create_access_token",
    "create_refresh_token",
    "decode_access_token",
    "decode_refresh_token",
    "hash_refresh_token",
    "LoginRequest",
    "UserResponse",
    "UserCreate",
]
