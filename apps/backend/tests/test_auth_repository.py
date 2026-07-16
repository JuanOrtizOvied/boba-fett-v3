"""Tests for `auth.repository.UserRepository` against a mocked `asyncpg.Pool`
(same pattern as `db.repository.ProductRepository` in `test_integration.py` —
no real Postgres required for unit tests).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from auth.tokens import REFRESH_TOKEN_TTL


def _fake_user_row(**overrides) -> dict:
    row = {
        "id": "usr_abc123",
        "email": "investor@sabbi.com",
        "password_hash": "$2b$hashed",
        "role": "user",
        "created_by": None,
    }
    row.update(overrides)
    return row


def test_get_by_email_returns_matching_row():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = _fake_user_row()

    repo = UserRepository(pool)
    user = asyncio.run(repo.get_by_email("investor@sabbi.com"))

    assert user["email"] == "investor@sabbi.com"
    pool.fetchrow.assert_awaited_once_with(
        "SELECT * FROM users WHERE email = $1", "investor@sabbi.com"
    )


def test_get_by_email_returns_none_when_not_found():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = None

    repo = UserRepository(pool)
    user = asyncio.run(repo.get_by_email("nobody@sabbi.com"))

    assert user is None


def test_get_by_id_returns_matching_row():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = _fake_user_row(id="usr_xyz")

    repo = UserRepository(pool)
    user = asyncio.run(repo.get_by_id("usr_xyz"))

    assert user["id"] == "usr_xyz"


def test_create_inserts_user_with_created_by():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = _fake_user_row(
        email="new@sabbi.com", role="admin", created_by="usr_admin"
    )

    repo = UserRepository(pool)
    user = asyncio.run(
        repo.create(
            email="new@sabbi.com",
            password_hash="$2b$xyz",
            role="admin",
            created_by="usr_admin",
        )
    )

    assert user["email"] == "new@sabbi.com"
    assert user["role"] == "admin"
    pool.fetchrow.assert_awaited_once()
    call_args = pool.fetchrow.call_args.args
    assert "INSERT INTO users" in call_args[0]
    assert call_args[1:] == ("new@sabbi.com", "$2b$xyz", "admin", "usr_admin")


def test_list_all_returns_every_user_ordered():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetch.return_value = [_fake_user_row(id="usr_1"), _fake_user_row(id="usr_2")]

    repo = UserRepository(pool)
    users = asyncio.run(repo.list_all())

    assert len(users) == 2
    pool.fetch.assert_awaited_once_with("SELECT * FROM users ORDER BY created_at")


def test_store_refresh_token_inserts_hash_with_expiry():
    from auth.repository import UserRepository

    pool = AsyncMock()

    repo = UserRepository(pool)
    asyncio.run(repo.store_refresh_token(user_id="usr_1", token_hash="hash123"))

    pool.execute.assert_awaited_once()
    call_args = pool.execute.call_args.args
    assert "INSERT INTO refresh_tokens" in call_args[0]
    assert call_args[1] == "usr_1"
    assert call_args[2] == "hash123"
    # third positional value is the expires_at datetime — must be roughly now + TTL
    assert call_args[3] is not None


def test_get_refresh_token_returns_matching_row():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "rt_1",
        "user_id": "usr_1",
        "token_hash": "hash123",
        "expires_at": "2030-01-01T00:00:00Z",
    }

    repo = UserRepository(pool)
    row = asyncio.run(repo.get_refresh_token("hash123"))

    assert row["user_id"] == "usr_1"
    pool.fetchrow.assert_awaited_once_with(
        "SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()", "hash123"
    )


def test_list_active_threads_returns_users_with_threads_ordered_by_activity():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetch.return_value = [
        _fake_user_row(id="usr_1", active_thread_id="th_1"),
        _fake_user_row(id="usr_2", active_thread_id="th_2"),
    ]

    repo = UserRepository(pool)
    rows = asyncio.run(repo.list_active_threads())

    assert len(rows) == 2
    query = pool.fetch.call_args.args[0]
    assert "WHERE active_thread_id IS NOT NULL AND active_thread_id <> ''" in query
    assert "ORDER BY updated_at DESC, created_at DESC" in query


def test_get_refresh_token_returns_none_when_missing():
    from auth.repository import UserRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = None

    repo = UserRepository(pool)
    row = asyncio.run(repo.get_refresh_token("does-not-exist"))

    assert row is None


def test_delete_refresh_token_executes_delete_by_hash():
    from auth.repository import UserRepository

    pool = AsyncMock()

    repo = UserRepository(pool)
    asyncio.run(repo.delete_refresh_token("hash123"))

    pool.execute.assert_awaited_once_with(
        "DELETE FROM refresh_tokens WHERE token_hash = $1", "hash123"
    )


def test_set_active_thread_id_updates_timestamp():
    from auth.repository import UserRepository

    pool = AsyncMock()

    repo = UserRepository(pool)
    asyncio.run(repo.set_active_thread_id("usr_1", "th_1"))

    pool.execute.assert_awaited_once_with(
        "UPDATE users SET active_thread_id = $1, updated_at = now() WHERE id = $2",
        "th_1",
        "usr_1",
    )


def test_refresh_token_ttl_is_seven_days():
    from datetime import timedelta

    assert REFRESH_TOKEN_TTL == timedelta(days=7)
