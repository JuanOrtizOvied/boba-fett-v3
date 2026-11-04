"""Persistence for the Ficha Patrimonial validation workbench (Slice 3a).

A parsed ficha is auto-saved with its lines; per-line decisions and a confirm
flag drive the derived status lifecycle (`derive_ficha_status`). The chat path
and the ephemeral parse/confirm flow are unaffected — this only ADDS storage.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import asyncpg
from pydantic import BaseModel, Field

from db.ficha_patrimonial import FichaClientInfo, FichaEnrichedRow, derive_ficha_status
from db.models import SearchResult


class FichaLine(BaseModel):
    id: int
    excel_row: int
    raw_name: str = ""
    raw_tipo_activo: str = ""
    raw_amount: float = 0.0
    raw_currency: str = ""
    raw_return_rate: str = ""
    raw_pertenencia: str = ""
    mapped_asset_class: str | None = None
    normalized_return_rate: str = ""
    enriched: SearchResult | None = None
    line_status: str = "pending"


class Ficha(BaseModel):
    id: int
    user_id: str | None = None
    client_name: str = ""
    client_email: str = ""
    client_phone: str = ""
    parse_failed: bool = False
    confirmed: bool = False
    created_at: datetime | None = None
    lines: list[FichaLine] = Field(default_factory=list)
    status: str = "por_validar"


class FichaListItem(BaseModel):
    id: int
    client_name: str = ""
    client_email: str = ""
    created_at: datetime | None = None
    line_count: int = 0
    status: str = "por_validar"


def _as_uuid(value: str | None) -> uuid.UUID | None:
    if not value:
        return None
    return uuid.UUID(value)


def _parse_enriched(raw: object) -> SearchResult | None:
    if raw is None:
        return None
    data = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
    return SearchResult.model_validate(data)


class FichaRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def create(
        self,
        client: FichaClientInfo,
        rows: list[FichaEnrichedRow],
        parse_failed: bool = False,
    ) -> int:
        """Persist a parsed ficha and its lines, returning the new ficha id."""
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                ficha_id = await conn.fetchval(
                    """
                    INSERT INTO ficha (user_id, client_name, client_email,
                                       client_phone, parse_failed)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                    """,
                    _as_uuid(client.user_id),
                    client.name,
                    client.email,
                    client.phone,
                    parse_failed,
                )
                for row in rows:
                    enriched_json = (
                        json.dumps(row.enriched.model_dump()) if row.enriched is not None else None
                    )
                    line_id = await conn.fetchval(
                        """
                        INSERT INTO ficha_line (
                            ficha_id, excel_row, raw_name, raw_tipo_activo,
                            raw_amount, raw_currency, raw_return_rate,
                            raw_pertenencia, mapped_asset_class,
                            normalized_return_rate, enriched)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        RETURNING id
                        """,
                        ficha_id,
                        row.excel_row,
                        row.raw_name,
                        row.raw_tipo_activo,
                        row.raw_amount,
                        row.raw_currency,
                        row.raw_return_rate,
                        row.raw_pertenencia,
                        row.mapped_asset_class,
                        row.normalized_return_rate,
                        enriched_json,
                    )
                    # Expose the new id so the parse response rows can be PATCHed.
                    row.line_id = line_id
        return ficha_id

    async def get(self, ficha_id: int) -> Ficha | None:
        row = await self._pool.fetchrow("SELECT * FROM ficha WHERE id = $1", ficha_id)
        if row is None:
            return None
        line_rows = await self._pool.fetch(
            "SELECT * FROM ficha_line WHERE ficha_id = $1 ORDER BY excel_row, id",
            ficha_id,
        )
        lines = [
            FichaLine(
                id=r["id"],
                excel_row=r["excel_row"],
                raw_name=r["raw_name"],
                raw_tipo_activo=r["raw_tipo_activo"],
                raw_amount=r["raw_amount"],
                raw_currency=r["raw_currency"],
                raw_return_rate=r["raw_return_rate"],
                raw_pertenencia=r["raw_pertenencia"],
                mapped_asset_class=r["mapped_asset_class"],
                normalized_return_rate=r["normalized_return_rate"],
                enriched=_parse_enriched(r["enriched"]),
                line_status=r["line_status"],
            )
            for r in line_rows
        ]
        status = derive_ficha_status(
            row["parse_failed"], [ln.line_status for ln in lines], row["confirmed"]
        )
        return Ficha(
            id=row["id"],
            user_id=str(row["user_id"]) if row["user_id"] is not None else None,
            client_name=row["client_name"],
            client_email=row["client_email"],
            client_phone=row["client_phone"],
            parse_failed=row["parse_failed"],
            confirmed=row["confirmed"],
            created_at=row["created_at"],
            lines=lines,
            status=status,
        )

    async def update_line_status(self, line_id: int, status: str) -> None:
        if status not in ("pending", "approved", "discarded"):
            raise ValueError(f"invalid line status: {status!r}")
        await self._pool.execute(
            "UPDATE ficha_line SET line_status = $1 WHERE id = $2", status, line_id
        )

    async def mark_confirmed(self, ficha_id: int) -> None:
        await self._pool.execute(
            "UPDATE ficha SET confirmed = true, updated_at = now() WHERE id = $1",
            ficha_id,
        )

    async def list(self, status: str | None = None) -> list[FichaListItem]:
        """List fichas (newest first), each with its derived status; filter by
        `status` when given."""
        rows = await self._pool.fetch(
            "SELECT id, client_name, client_email, parse_failed, confirmed, "
            "created_at FROM ficha ORDER BY created_at DESC, id DESC"
        )
        line_rows = await self._pool.fetch("SELECT ficha_id, line_status FROM ficha_line")
        by_ficha: dict[int, list[str]] = {}
        for lr in line_rows:
            by_ficha.setdefault(lr["ficha_id"], []).append(lr["line_status"])

        items: list[FichaListItem] = []
        for r in rows:
            statuses = by_ficha.get(r["id"], [])
            derived = derive_ficha_status(r["parse_failed"], statuses, r["confirmed"])
            if status is not None and derived != status:
                continue
            items.append(
                FichaListItem(
                    id=r["id"],
                    client_name=r["client_name"],
                    client_email=r["client_email"],
                    created_at=r["created_at"],
                    line_count=len(statuses),
                    status=derived,
                )
            )
        return items
