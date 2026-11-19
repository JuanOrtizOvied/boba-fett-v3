"""Database access for the properties section (`property_holding`).

Two read sides live here. The sync one returns every row typed like the parser's
values so the diff can compare them. The admin one groups the active rows by
property code: the table has one row per `(code, client)`, the screen shows one
property with its owners. Nothing here writes; the sync is the only writer.
"""

from __future__ import annotations

import json
import unicodedata
from typing import Any

import asyncpg
from pydantic import BaseModel

from properties_sync.config import PROPERTY_COLUMNS
from properties_sync.diff import ExistingRow

# Column names come from `properties_sync.config`, never from user input.
_SYNC_COLUMNS = ", ".join(column.field for column in PROPERTY_COLUMNS)


class Allocation(BaseModel):
    name: str
    percentage: float


class PropertySummary(BaseModel):
    """One entry of the list: the property, not one of its owner rows."""

    code: str
    name: str
    usage: str
    manager: str
    administrator: str
    estimated_value_usd: float | None
    ownership: int
    asset_class: list[Allocation]
    geographic_focus: list[Allocation]
    underlying: list[Allocation]


class PropertyOwner(BaseModel):
    """What belongs to the client and not to the property."""

    client: str
    ownership_pct: float | None
    flows_min: float | None
    flows_max: float | None
    return_min: float | None
    return_max: float | None
    monthly_rent_usd: float | None


class PropertyDetail(BaseModel):
    code: str
    name: str
    usage: str
    manager: str
    administrator: str
    currency: str
    investment_horizon: str
    estimated_value_usd: float | None
    asset_class: list[Allocation]
    geographic_focus: list[Allocation]
    underlying: list[Allocation]
    owners: list[PropertyOwner]


def normalize_search_text(value: str) -> str:
    """Lower case, no accents, spaces collapsed: what a search compares."""
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(without_accents.split())


def _number(raw: Any) -> float | None:
    return None if raw is None else float(raw)


def _text(raw: Any) -> str:
    return "" if raw is None else str(raw)


def _allocation_models(raw: Any) -> list[Allocation]:
    return [Allocation(name=name, percentage=pct) for name, pct in _allocations(raw)]


def _allocations(raw: Any) -> tuple[tuple[str, float], ...]:
    if raw is None:
        return ()
    items = json.loads(raw) if isinstance(raw, str) else raw
    return tuple((item["name"], float(item["percentage"])) for item in items)


def to_existing_row(record: Any) -> ExistingRow:
    """A `property_holding` record as the diff needs it: numbers as `float | None`
    (the column is NUMERIC, so `Decimal` comes back), allocations as a tuple of
    `(name, percentage)` and a missing text as an empty string."""
    values: dict[str, Any] = {}
    for column in PROPERTY_COLUMNS:
        raw = record[column.field]
        if column.type == "number":
            values[column.field] = None if raw is None else float(raw)
        elif column.type == "allocations":
            values[column.field] = _allocations(raw)
        else:
            values[column.field] = "" if raw is None else raw
    return ExistingRow(
        key=(record["code"], record["client"]),
        values=values,
        is_deleted=bool(record["is_deleted"]),
    )


class PropertyRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @property
    def pool(self) -> asyncpg.Pool:
        return self._pool

    async def list_for_sync(self) -> list[ExistingRow]:
        """Every row of the table, deleted ones included, for the diff."""
        rows = await self._pool.fetch(
            f"SELECT {_SYNC_COLUMNS}, is_deleted FROM property_holding ORDER BY id"
        )
        return [to_existing_row(row) for row in rows]

    async def list_properties(self, search: str | None = None) -> list[PropertySummary]:
        """Active properties ordered by code, one entry per code. The property's own
        fields come from its first row (lowest id); `ownership` counts its active
        rows. `search` keeps a property when its code, its name or the client of
        any of its rows contains the text, ignoring case and accents."""
        rows = await self._pool.fetch(
            "SELECT code, client, name, manager, administrator, usage, asset_class, "
            "geographic_focus, underlying, estimated_value_usd "
            "FROM property_holding WHERE NOT is_deleted ORDER BY code, id"
        )
        needle = normalize_search_text(search) if search else ""
        groups: dict[str, list[Any]] = {}
        for row in rows:
            groups.setdefault(row["code"], []).append(row)

        entries: list[PropertySummary] = []
        for code, members in groups.items():
            if needle and not any(
                needle in normalize_search_text(f"{code} {_text(m['name'])} {m['client']}")
                for m in members
            ):
                continue
            first = members[0]
            entries.append(
                PropertySummary(
                    code=code,
                    name=_text(first["name"]),
                    usage=_text(first["usage"]),
                    manager=_text(first["manager"]),
                    administrator=_text(first["administrator"]),
                    estimated_value_usd=_number(first["estimated_value_usd"]),
                    ownership=len(members),
                    asset_class=_allocation_models(first["asset_class"]),
                    geographic_focus=_allocation_models(first["geographic_focus"]),
                    underlying=_allocation_models(first["underlying"]),
                )
            )
        return entries

    async def get_property(self, code: str) -> PropertyDetail | None:
        """The property with one owner entry per active row, or None when the code
        has no active row."""
        rows = await self._pool.fetch(
            f"SELECT {_SYNC_COLUMNS} FROM property_holding "
            "WHERE code = $1 AND NOT is_deleted ORDER BY id",
            code,
        )
        if not rows:
            return None
        first = rows[0]
        return PropertyDetail(
            code=first["code"],
            name=_text(first["name"]),
            usage=_text(first["usage"]),
            manager=_text(first["manager"]),
            administrator=_text(first["administrator"]),
            currency=_text(first["currency"]),
            investment_horizon=_text(first["investment_horizon"]),
            estimated_value_usd=_number(first["estimated_value_usd"]),
            asset_class=_allocation_models(first["asset_class"]),
            geographic_focus=_allocation_models(first["geographic_focus"]),
            underlying=_allocation_models(first["underlying"]),
            owners=[
                PropertyOwner(
                    client=row["client"],
                    ownership_pct=_number(row["ownership_pct"]),
                    flows_min=_number(row["flows_min"]),
                    flows_max=_number(row["flows_max"]),
                    return_min=_number(row["return_min"]),
                    return_max=_number(row["return_max"]),
                    monthly_rent_usd=_number(row["monthly_rent_usd"]),
                )
                for row in rows
            ],
        )
