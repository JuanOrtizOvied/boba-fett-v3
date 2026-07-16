"""Data access for the `users` and `refresh_tokens` tables.

Kept as a separate repository from `db.repository.ProductRepository`
because it serves the auth domain rather than portfolio data, even though
both share the same process-wide `asyncpg.Pool` (`db.connection.get_pool`).
Refresh tokens are stored hashed (`auth.tokens.hash_refresh_token`) — the
raw JWT is never persisted (`user-auth/spec.md` — "Refresh Token
Lifecycle").
"""

from __future__ import annotations

from datetime import datetime, timezone

import asyncpg

from auth.tokens import REFRESH_TOKEN_TTL


class UserRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def get_by_email(self, email: str) -> asyncpg.Record | None:
        return await self.pool.fetchrow("SELECT * FROM users WHERE email = $1", email)

    async def get_by_id(self, user_id: str) -> asyncpg.Record | None:
        return await self.pool.fetchrow("SELECT * FROM users WHERE id = $1", user_id)

    async def create(
        self, *, email: str, password_hash: str, role: str, created_by: str | None
    ) -> asyncpg.Record:
        return await self.pool.fetchrow(
            """INSERT INTO users (email, password_hash, role, created_by)
               VALUES ($1, $2, $3, $4) RETURNING *""",
            email,
            password_hash,
            role,
            created_by,
        )

    async def list_all(self) -> list[asyncpg.Record]:
        return await self.pool.fetch("SELECT * FROM users ORDER BY created_at")

    async def list_active_threads(self) -> list[asyncpg.Record]:
        return await self.pool.fetch(
            """SELECT id, email, active_thread_id, updated_at, created_at
               FROM users
               WHERE active_thread_id IS NOT NULL AND active_thread_id <> ''
               ORDER BY updated_at DESC, created_at DESC"""
        )

    async def store_refresh_token(self, *, user_id: str, token_hash: str) -> None:
        expires_at = datetime.now(timezone.utc) + REFRESH_TOKEN_TTL
        await self.pool.execute(
            """INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
               VALUES ($1, $2, $3)""",
            user_id,
            token_hash,
            expires_at,
        )

    async def get_refresh_token(self, token_hash: str) -> asyncpg.Record | None:
        return await self.pool.fetchrow(
            "SELECT * FROM refresh_tokens WHERE token_hash = $1 AND expires_at > now()",
            token_hash,
        )

    async def delete_refresh_token(self, token_hash: str) -> None:
        await self.pool.execute(
            "DELETE FROM refresh_tokens WHERE token_hash = $1", token_hash
        )

    async def get_active_thread_id(self, user_id: str) -> str | None:
        row = await self.pool.fetchrow(
            "SELECT active_thread_id FROM users WHERE id = $1", user_id
        )
        return row["active_thread_id"] if row else None

    async def set_active_thread_id(self, user_id: str, thread_id: str) -> None:
        await self.pool.execute(
            "UPDATE users SET active_thread_id = $1, updated_at = now() WHERE id = $2",
            thread_id,
            user_id,
        )
