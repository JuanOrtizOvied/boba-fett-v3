"""Tests for admin bootstrap seeding (`auth.seed`).

Covers `design.md` — "Migration / Rollout": on first boot, `seed_admin()`
creates the admin user from `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars, and
must be idempotent (safe to call on every startup).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock


def test_seed_admin_creates_user_when_none_exists(monkeypatch):
    from auth.seed import seed_admin

    monkeypatch.setenv("ADMIN_EMAIL", "admin@sabbi.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "correct-horse-battery-staple")

    pool = AsyncMock()
    pool.fetchrow.return_value = None  # no existing admin

    asyncio.run(seed_admin(pool))

    pool.fetchrow.assert_awaited_once()
    pool.execute.assert_awaited_once()
    insert_args = pool.execute.await_args.args
    assert "INSERT INTO users" in insert_args[0]
    assert insert_args[1] == "admin@sabbi.com"
    # the raw password must never be persisted — only its hash
    assert insert_args[2] != "correct-horse-battery-staple"
    assert insert_args[3] == "admin"


def test_seed_admin_is_idempotent_when_admin_already_exists(monkeypatch):
    from auth.seed import seed_admin

    monkeypatch.setenv("ADMIN_EMAIL", "admin@sabbi.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "correct-horse-battery-staple")

    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "usr_existing"}  # admin already exists

    asyncio.run(seed_admin(pool))

    pool.fetchrow.assert_awaited_once()
    pool.execute.assert_not_awaited()


def test_seed_admin_skips_when_env_vars_missing(monkeypatch):
    from auth.seed import seed_admin

    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)

    pool = AsyncMock()

    asyncio.run(seed_admin(pool))

    pool.fetchrow.assert_not_awaited()
    pool.execute.assert_not_awaited()


def test_seed_admin_stores_bcrypt_hash_not_plaintext(monkeypatch):
    from auth.passwords import verify_password
    from auth.seed import seed_admin

    monkeypatch.setenv("ADMIN_EMAIL", "root@sabbi.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "another-strong-password")

    pool = AsyncMock()
    pool.fetchrow.return_value = None

    asyncio.run(seed_admin(pool))

    stored_hash = pool.execute.await_args.args[2]
    assert verify_password("another-strong-password", stored_hash) is True
