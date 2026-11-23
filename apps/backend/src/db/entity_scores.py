"""The `administrator` and `manager` tables as the admin view reads and edits them.

Both tables have the same shape (name, score, slugs, timestamps, `deleted_at`), so one
repository serves them. The table name never comes from the request: a fixed kind maps to
a fixed table name, and only values are passed as query parameters.

A row is deleted softly: `deleted_at` is set and the row stays, with its name taken
(`name` is `UNIQUE`), until it is restored. Every write sets `updated_at`.

The old `CatalogRepository.list_administrators` / `list_managers` (id, name, score) keep
serving the old catalog modal; this module is the one with slugs and deleted rows.
"""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterable
from datetime import datetime
from typing import Annotated, Any

import asyncpg
from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from db.catalog_normalized import slugify_name

KINDS = ("administrators", "managers")
_TABLES = {"administrators": "administrator", "managers": "manager"}
# Advisory locks (one per table) that serialize the writes that check the name, so two
# admins saving the same name, in any case or accent, cannot both pass the check.
_LOCK_KEYS = {"administrator": 8_401_002_010, "manager": 8_401_002_011}

MAX_NAME = 200
MAX_SLUGS = 30
MAX_SLUG = 100
_COLUMNS = "id, name, score, slugs, deleted_at"

Score = Annotated[int, Field(strict=True, ge=1, le=10)]
Slug = Annotated[str, StringConstraints(max_length=MAX_SLUG)]


def clean_name(value: str) -> str:
    """Trimmed, with every run of spaces collapsed to one."""
    return " ".join(value.split())


def fold(value: str) -> str:
    """Lower case, no accents, spaces collapsed: what names and searches compare."""
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(without_accents.split())


def normalize_slugs(name: str, slugs: Iterable[str]) -> list[str]:
    """Each slug in the catalog's slug form, empties and repeats dropped, order kept, and
    the slug of the name added in front when missing. Nothing the caller kept is removed."""
    result: list[str] = []
    for raw in slugs:
        slug = slugify_name(raw)
        if slug and slug not in result:
            result.append(slug)
    own = slugify_name(name)
    if own and own not in result:
        result.insert(0, own)
    return result


def _stored_slugs(raw: Any) -> list[str]:
    """The slugs of a row: the JSONB array, or empty when it is not a list of strings."""
    value = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return list(value)
    return []


class EntityScore(BaseModel):
    id: int
    name: str
    score: int | None = None
    slugs: list[str] = Field(default_factory=list)
    deleted_at: datetime | None = None


class EntityScoreCreate(BaseModel):
    name: str
    score: Score | None = None
    slugs: list[Slug] = Field(default_factory=list, max_length=MAX_SLUGS)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = clean_name(value)
        if not value or len(value) > MAX_NAME:
            raise ValueError(f"name must have 1 to {MAX_NAME} characters")
        return value


class EntityScoreUpdate(BaseModel):
    """Only the fields sent change. An explicit `score: null` clears the score."""

    name: str | None = None
    score: Score | None = None
    slugs: list[Slug] | None = Field(default=None, max_length=MAX_SLUGS)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = clean_name(value)
        if not value or len(value) > MAX_NAME:
            raise ValueError(f"name must have 1 to {MAX_NAME} characters")
        return value

    @model_validator(mode="after")
    def _not_null(self) -> EntityScoreUpdate:
        for field in ("name", "slugs"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class DuplicateNameError(Exception):
    """The name is taken by another row. `deleted` says whether every such row is deleted,
    so the screen can offer to restore it instead."""

    def __init__(self, *, deleted: bool) -> None:
        super().__init__("exists_deleted" if deleted else "exists")
        self.deleted = deleted


def _to_entity(row: asyncpg.Record) -> EntityScore:
    return EntityScore(
        id=row["id"],
        name=row["name"],
        score=row["score"],
        slugs=_stored_slugs(row["slugs"]),
        deleted_at=row["deleted_at"],
    )


class EntityScoreRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @staticmethod
    def _table(kind: str) -> str:
        try:
            return _TABLES[kind]
        except KeyError:
            raise ValueError(f"unknown kind: {kind}") from None

    async def list_entities(
        self, kind: str, search: str | None = None, *, include_deleted: bool = False
    ) -> list[EntityScore]:
        """Active rows ordered by name ignoring case, then id; deleted rows too with
        `include_deleted`. `search` keeps a row when its name or any slug contains the
        text, ignoring case and accents."""
        table = self._table(kind)
        where = "" if include_deleted else " WHERE deleted_at IS NULL"
        rows = await self._pool.fetch(
            f"SELECT {_COLUMNS} FROM {table}{where} ORDER BY lower(name), id"
        )
        needle = fold(search) if search else ""
        entities = [_to_entity(row) for row in rows]
        if not needle:
            return entities
        return [e for e in entities if needle in fold(e.name) or any(needle in s for s in e.slugs)]

    async def _check_name(
        self, conn: asyncpg.Connection, table: str, name: str, exclude_id: int | None
    ) -> None:
        """Refuse a name another row already has, ignoring case, accents and spaces and
        counting deleted rows (the name is unique across them)."""
        wanted = fold(name)
        rows = await conn.fetch(f"SELECT id, name, deleted_at FROM {table}")
        clashes = [r for r in rows if r["id"] != exclude_id and fold(r["name"]) == wanted]
        if clashes:
            raise DuplicateNameError(deleted=all(r["deleted_at"] is not None for r in clashes))

    async def create(self, kind: str, data: EntityScoreCreate) -> EntityScore:
        table = self._table(kind)
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEYS[table])
            await self._check_name(conn, table, data.name, None)
            slugs = normalize_slugs(data.name, data.slugs)
            try:
                row = await conn.fetchrow(
                    f"INSERT INTO {table} (name, score, slugs, updated_at) "
                    f"VALUES ($1, $2, $3::jsonb, now()) RETURNING {_COLUMNS}",
                    data.name,
                    data.score,
                    json.dumps(slugs),
                )
            except asyncpg.UniqueViolationError:
                raise DuplicateNameError(deleted=False) from None
        return _to_entity(row)

    async def update(
        self, kind: str, entity_id: int, data: EntityScoreUpdate
    ) -> EntityScore | None:
        """Change the fields sent on an active row. `None` when there is no such active row."""
        table = self._table(kind)
        sent = data.model_fields_set
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEYS[table])
            current = await conn.fetchrow(
                f"SELECT {_COLUMNS} FROM {table} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
                entity_id,
            )
            if current is None:
                return None
            name = data.name if "name" in sent and data.name is not None else current["name"]
            if "name" in sent:
                await self._check_name(conn, table, name, entity_id)
            score = data.score if "score" in sent else current["score"]
            slugs = _stored_slugs(current["slugs"])
            if "slugs" in sent and data.slugs is not None:
                slugs = normalize_slugs(name, data.slugs)
            elif "name" in sent:
                slugs = normalize_slugs(name, slugs)
            try:
                row = await conn.fetchrow(
                    f"UPDATE {table} SET name = $1, score = $2, slugs = $3::jsonb, "
                    f"updated_at = now() WHERE id = $4 RETURNING {_COLUMNS}",
                    name,
                    score,
                    json.dumps(slugs),
                    entity_id,
                )
            except asyncpg.UniqueViolationError:
                raise DuplicateNameError(deleted=False) from None
        return _to_entity(row)

    async def delete(self, kind: str, entity_id: int) -> bool:
        """Soft delete an active row. `False` when there is no such active row."""
        table = self._table(kind)
        deleted_id = await self._pool.fetchval(
            f"UPDATE {table} SET deleted_at = now(), updated_at = now() "
            "WHERE id = $1 AND deleted_at IS NULL RETURNING id",
            entity_id,
        )
        return deleted_id is not None

    async def restore(self, kind: str, entity_id: int) -> EntityScore | None:
        """Bring a deleted row back. `None` when the row is unknown or not deleted."""
        table = self._table(kind)
        row = await self._pool.fetchrow(
            f"UPDATE {table} SET deleted_at = NULL, updated_at = now() "
            f"WHERE id = $1 AND deleted_at IS NOT NULL RETURNING {_COLUMNS}",
            entity_id,
        )
        return None if row is None else _to_entity(row)
