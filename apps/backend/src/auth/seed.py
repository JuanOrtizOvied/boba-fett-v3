"""Idempotent admin bootstrap seeding.

`design.md` — "Migration / Rollout": on first boot, `seed_admin()` creates
the admin user from `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars, and it is
safe to call on every startup (`db.connection.get_pool` calls it after the
schema is applied).
"""

from __future__ import annotations

import logging
import os

import asyncpg

from auth.passwords import hash_password

logger = logging.getLogger(__name__)


async def seed_admin(pool: asyncpg.Pool) -> None:
    """Create the initial admin user if it does not already exist.

    No-op (with a warning) if `ADMIN_EMAIL`/`ADMIN_PASSWORD` are not set —
    this keeps local/dev boots from crashing when the operator hasn't
    configured admin credentials yet.
    """
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")

    if not admin_email or not admin_password:
        logger.warning(
            "ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin seed"
        )
        return

    existing = await pool.fetchrow(
        "SELECT id FROM users WHERE email = $1", admin_email
    )
    if existing is not None:
        return

    password_hash = hash_password(admin_password)
    await pool.execute(
        "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)",
        admin_email,
        password_hash,
        "admin",
    )
