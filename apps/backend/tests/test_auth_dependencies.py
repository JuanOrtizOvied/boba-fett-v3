"""Tests for FastAPI auth dependencies (`auth.dependencies`).

Covers `user-auth/spec.md` — "Access Token Validation" (valid/expired/missing
cookie) and `access-control/spec.md` — "Role-Based Route Protection" (admin
role gate on top of `get_current_user`).
"""

from __future__ import annotations

import asyncio
import time

import jwt
import pytest
from fastapi import HTTPException


def test_get_current_user_returns_user_dict_for_valid_cookie():
    from auth.dependencies import get_current_user
    from auth.tokens import create_access_token

    token = create_access_token(user_id="usr_123", email="a@sabbi.com", role="user")

    user = asyncio.run(get_current_user(sabbi_access=token))

    assert user == {"id": "usr_123", "email": "a@sabbi.com", "role": "user"}


def test_get_current_user_raises_401_when_cookie_missing():
    from auth.dependencies import get_current_user

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(get_current_user(sabbi_access=None))

    assert exc_info.value.status_code == 401


def test_get_current_user_raises_401_when_token_expired():
    from auth.dependencies import get_current_user

    now = int(time.time())
    expired_payload = {
        "sub": "usr_123",
        "email": "a@sabbi.com",
        "role": "user",
        "type": "access",
        "iat": now - 1000,
        "exp": now - 1,
    }
    expired_token = jwt.encode(
        expired_payload, "test-access-secret-at-least-32-bytes-long", algorithm="HS256"
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(get_current_user(sabbi_access=expired_token))

    assert exc_info.value.status_code == 401


def test_get_current_user_raises_401_for_malformed_token():
    from auth.dependencies import get_current_user

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(get_current_user(sabbi_access="not-a-real-jwt"))

    assert exc_info.value.status_code == 401


def test_require_admin_allows_admin_role():
    from auth.dependencies import require_admin

    admin_user = {"id": "usr_1", "email": "admin@sabbi.com", "role": "admin"}

    result = asyncio.run(require_admin(user=admin_user))

    assert result == admin_user


def test_require_admin_raises_403_for_user_role():
    from auth.dependencies import require_admin

    non_admin = {"id": "usr_2", "email": "u@sabbi.com", "role": "user"}

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(require_admin(user=non_admin))

    assert exc_info.value.status_code == 403
