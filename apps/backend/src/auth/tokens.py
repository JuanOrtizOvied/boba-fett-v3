"""JWT access/refresh token issuance and validation for SABBI auth.

Design (`openspec/changes/sabbi-auth/design.md`):
  - Access tokens: 15 min TTL, signed with `JWT_SECRET`.
  - Refresh tokens: 7 day TTL, signed with `JWT_REFRESH_SECRET`, and the
    caller MUST persist `hash_refresh_token(token)` server-side
    (`refresh_tokens.token_hash`) — a valid signature alone is not enough,
    the refresh token must also be looked up in the DB
    (user-auth/spec.md — "Refresh Token Lifecycle").
  - Claims: `{sub, email, role, iat, exp, type: "access" | "refresh"}`.
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

ALGORITHM = "HS256"
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_TOKEN_TTL = timedelta(days=7)


def _access_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET environment variable is required")
    return secret


def _refresh_secret() -> str:
    secret = os.environ.get("JWT_REFRESH_SECRET")
    if not secret:
        raise RuntimeError("JWT_REFRESH_SECRET environment variable is required")
    return secret


def _encode(claims: dict[str, Any], secret: str) -> str:
    return jwt.encode(claims, secret, algorithm=ALGORITHM)


def create_access_token(*, user_id: str, email: str, role: str) -> str:
    """Create a short-lived (15 min) access token carrying user identity
    and role for FastAPI route authorization."""
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + ACCESS_TOKEN_TTL,
    }
    return _encode(claims, _access_secret())


def create_refresh_token(*, user_id: str) -> str:
    """Create a long-lived (7 day) refresh token. The caller is responsible
    for storing `hash_refresh_token(token)` in `refresh_tokens` so it can be
    validated server-side (not merely decoded) on `/auth/refresh`."""
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "type": "refresh",
        "iat": now,
        "exp": now + REFRESH_TOKEN_TTL,
    }
    return _encode(claims, _refresh_secret())


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate an access token. Raises `jwt.ExpiredSignatureError`
    if expired, or `jwt.InvalidTokenError` (including wrong `type`) otherwise."""
    payload = jwt.decode(token, _access_secret(), algorithms=[ALGORITHM])
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Token is not an access token")
    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    """Decode and validate a refresh token's signature/expiry. Signature
    validity alone is NOT sufficient to accept a refresh — the caller MUST
    also verify `hash_refresh_token(token)` exists in `refresh_tokens`."""
    payload = jwt.decode(token, _refresh_secret(), algorithms=[ALGORITHM])
    if payload.get("type") != "refresh":
        raise jwt.InvalidTokenError("Token is not a refresh token")
    return payload


def hash_refresh_token(token: str) -> str:
    """One-way hash of a refresh token for storage in
    `refresh_tokens.token_hash` — the raw JWT is never persisted."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
