"""Tests for JWT access/refresh tokens (`auth.tokens`).

Covers the "Login" and "Refresh Token Lifecycle" requirements in
`openspec/specs/user-auth/spec.md`: 15 min access tokens, 7 day refresh
tokens, and server-side refresh token hash verification.
"""

from __future__ import annotations

import time
from datetime import timedelta

import jwt
import pytest


def test_create_access_token_encodes_expected_claims():
    from auth.tokens import create_access_token

    token = create_access_token(
        user_id="usr_123", email="admin@sabbi.com", role="admin"
    )
    payload = jwt.decode(token, "test-access-secret-at-least-32-bytes-long", algorithms=["HS256"])

    assert payload["sub"] == "usr_123"
    assert payload["email"] == "admin@sabbi.com"
    assert payload["role"] == "admin"
    assert payload["type"] == "access"
    assert "exp" in payload
    assert "iat" in payload


def test_create_access_token_expires_in_fifteen_minutes():
    from auth.tokens import ACCESS_TOKEN_TTL, create_access_token

    assert ACCESS_TOKEN_TTL == timedelta(minutes=15)

    token = create_access_token(user_id="usr_123", email="a@b.com", role="user")
    payload = jwt.decode(token, "test-access-secret-at-least-32-bytes-long", algorithms=["HS256"])

    assert payload["exp"] - payload["iat"] == 15 * 60


def test_create_refresh_token_expires_in_seven_days():
    from auth.tokens import REFRESH_TOKEN_TTL, create_refresh_token

    assert REFRESH_TOKEN_TTL == timedelta(days=7)

    token = create_refresh_token(user_id="usr_123")
    payload = jwt.decode(token, "test-refresh-secret-at-least-32-bytes-long", algorithms=["HS256"])

    assert payload["sub"] == "usr_123"
    assert payload["type"] == "refresh"
    assert payload["exp"] - payload["iat"] == 7 * 24 * 60 * 60


def test_decode_access_token_returns_payload_for_valid_token():
    from auth.tokens import create_access_token, decode_access_token

    token = create_access_token(user_id="usr_456", email="u@b.com", role="user")
    payload = decode_access_token(token)

    assert payload["sub"] == "usr_456"
    assert payload["role"] == "user"


def test_decode_access_token_raises_on_expired_token():
    from auth.tokens import decode_access_token

    now = int(time.time())
    expired_payload = {
        "sub": "usr_123",
        "email": "a@b.com",
        "role": "user",
        "type": "access",
        "iat": now - 1000,
        "exp": now - 1,
    }
    expired_token = jwt.encode(
        expired_payload, "test-access-secret-at-least-32-bytes-long", algorithm="HS256"
    )

    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(expired_token)


def test_decode_access_token_rejects_refresh_token_type():
    from auth.tokens import create_refresh_token, decode_access_token

    refresh_token = create_refresh_token(user_id="usr_123")

    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(refresh_token)


def test_decode_refresh_token_returns_payload_for_valid_token():
    from auth.tokens import create_refresh_token, decode_refresh_token

    token = create_refresh_token(user_id="usr_789")
    payload = decode_refresh_token(token)

    assert payload["sub"] == "usr_789"
    assert payload["type"] == "refresh"


def test_decode_refresh_token_rejects_access_token_type():
    from auth.tokens import create_access_token, decode_refresh_token

    access_token = create_access_token(user_id="usr_123", email="a@b.com", role="user")

    with pytest.raises(jwt.InvalidTokenError):
        decode_refresh_token(access_token)


def test_hash_refresh_token_is_deterministic_and_not_reversible():
    from auth.tokens import hash_refresh_token

    token = "some.refresh.jwt"
    first = hash_refresh_token(token)
    second = hash_refresh_token(token)

    assert first == second
    assert first != token
