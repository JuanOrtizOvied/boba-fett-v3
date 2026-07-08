"""Tests for auth Pydantic models (`auth.models`)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_login_request_requires_email_and_password():
    from auth.models import LoginRequest

    login = LoginRequest(email="user@sabbi.com", password="secret123")

    assert login.email == "user@sabbi.com"
    assert login.password == "secret123"


def test_login_request_rejects_missing_password():
    from auth.models import LoginRequest

    with pytest.raises(ValidationError):
        LoginRequest(email="user@sabbi.com")


def test_user_response_never_carries_password_hash():
    from auth.models import UserResponse

    user = UserResponse(id="usr_123", email="user@sabbi.com", role="user")

    assert user.id == "usr_123"
    assert user.role == "user"
    assert not hasattr(user, "password_hash")
    assert "password_hash" not in user.model_dump()


def test_user_create_defaults_role_to_user():
    from auth.models import UserCreate

    created = UserCreate(email="new@sabbi.com", password="password123")

    assert created.role == "user"


def test_user_create_accepts_admin_role():
    from auth.models import UserCreate

    created = UserCreate(email="new@sabbi.com", password="password123", role="admin")

    assert created.role == "admin"


def test_user_create_rejects_invalid_role():
    from auth.models import UserCreate

    with pytest.raises(ValidationError):
        UserCreate(email="new@sabbi.com", password="password123", role="superadmin")
