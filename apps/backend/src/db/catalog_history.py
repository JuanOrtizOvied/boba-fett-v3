"""Change history for the normalized V2 catalog (ficha-catalog-curation).

Records who changed which `catalog_product`, when, and what fields changed
(old → new), so catalog curation driven by fichas is auditable.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

import asyncpg
from pydantic import BaseModel, Field


class CatalogHistoryEntry(BaseModel):
    id: int
    product_code: str
    action: str  # 'create' | 'update'
    changed_by: str | None = None
    source: str = "ficha"
    changes: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


def _as_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    return uuid.UUID(value)


def _as_dict(raw: object) -> dict[str, Any]:
    if raw is None:
        return {}
    return json.loads(raw) if isinstance(raw, (str, bytes)) else raw


class CatalogHistoryRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def record(
        self,
        product_code: str,
        action: str,
        changed_by: str | None,
        source: str,
        changes: dict[str, Any],
    ) -> int:
        """Append a history row; returns its id."""
        return await self._pool.fetchval(
            """
            INSERT INTO catalog_product_history
                (product_code, action, changed_by, source, changes)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
            """,
            product_code,
            action,
            _as_uuid(changed_by),
            source,
            json.dumps(changes),
        )

    async def list_for_product(self, product_code: str) -> list[CatalogHistoryEntry]:
        """History for one catalog product, newest first."""
        rows = await self._pool.fetch(
            "SELECT * FROM catalog_product_history WHERE product_code = $1 "
            "ORDER BY created_at DESC, id DESC",
            product_code,
        )
        return [
            CatalogHistoryEntry(
                id=r["id"],
                product_code=r["product_code"],
                action=r["action"],
                changed_by=str(r["changed_by"]) if r["changed_by"] is not None else None,
                source=r["source"],
                changes=_as_dict(r["changes"]),
                created_at=r["created_at"],
            )
            for r in rows
        ]
