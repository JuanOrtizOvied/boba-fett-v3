"""The Markowitz correlation matrix of asset classes as the admin view reads it.

Two tables: `markowitz_asset` (one row per asset class; `position` orders both the rows and
the columns) and `markowitz_correlation` (one row per cell, both directions stored, so a
pair that is not symmetric shows). The database keeps the range of a value (-1 to 1) and the
diagonal (always 1); that the matrix is complete is kept by the code that writes it.

The risk lambda still reads its own constant, not these tables: nothing here changes a score
yet.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from datetime import datetime
from decimal import Decimal
from typing import Any

import asyncpg
from pydantic import BaseModel, Field


def _stored_slugs(raw: Any) -> list[str]:
    """The slugs of an asset: the JSONB array, or empty when it is not a list of strings."""
    value = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return list(value)
    return []


class MarkowitzAsset(BaseModel):
    id: int
    name: str
    slugs: list[str] = Field(default_factory=list)
    position: int
    updated_at: datetime


class MarkowitzReviewPair(BaseModel):
    """Two assets whose two directions differ. `a_to_b` is the row of `a` and the column
    of `b`; `b_to_a` is the opposite cell."""

    a_id: int
    b_id: int
    a_to_b: float
    b_to_a: float


class MarkowitzMatrix(BaseModel):
    """`values[i][j]` is the correlation of `assets[i]` (row) with `assets[j]` (column).
    A cell the database does not hold is `None`; that only happens when rows were written
    outside the app, and the screen shows it as missing instead of guessing a number."""

    assets: list[MarkowitzAsset] = Field(default_factory=list)
    values: list[list[float | None]] = Field(default_factory=list)
    review: list[MarkowitzReviewPair] = Field(default_factory=list)


def build_matrix(
    asset_rows: Iterable[Mapping[str, Any]], cell_rows: Iterable[Mapping[str, Any]]
) -> MarkowitzMatrix:
    """Puts the rows in matrix form. Assets go by `position`; a cell that names an asset
    that is not in the list (added between two reads) is ignored; a missing cell is `None`.
    The review list has one entry per unordered pair whose two directions differ, the
    largest gap first, then by name."""
    assets = [
        MarkowitzAsset(
            id=row["id"],
            name=row["name"],
            slugs=_stored_slugs(row["slugs"]),
            position=row["position"],
            updated_at=row["updated_at"],
        )
        for row in sorted(asset_rows, key=lambda r: (r["position"], r["id"]))
    ]
    index = {asset.id: i for i, asset in enumerate(assets)}
    size = len(assets)
    exact: list[list[Decimal | None]] = [[None] * size for _ in range(size)]
    for cell in cell_rows:
        i, j = index.get(cell["row_asset_id"]), index.get(cell["col_asset_id"])
        if i is not None and j is not None:
            exact[i][j] = Decimal(cell["value"])

    pairs: list[tuple[Decimal, str, str, MarkowitzReviewPair]] = []
    for i in range(size):
        for j in range(i + 1, size):
            a, b = exact[i][j], exact[j][i]
            if a is None or b is None or a == b:
                continue
            pairs.append(
                (
                    abs(a - b),
                    assets[i].name.casefold(),
                    assets[j].name.casefold(),
                    MarkowitzReviewPair(
                        a_id=assets[i].id, b_id=assets[j].id, a_to_b=float(a), b_to_a=float(b)
                    ),
                )
            )
    pairs.sort(key=lambda p: (-p[0], p[1], p[2]))

    return MarkowitzMatrix(
        assets=assets,
        values=[[None if v is None else float(v) for v in row] for row in exact],
        review=[p[3] for p in pairs],
    )


class MarkowitzRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def get_matrix(self) -> MarkowitzMatrix:
        """The whole matrix and the pairs to review. The assets are read first, so a cell
        that belongs to an asset added a moment later is left out instead of unbalancing
        the square."""
        asset_rows = await self._pool.fetch(
            "SELECT id, name, slugs, position, updated_at FROM markowitz_asset "
            "ORDER BY position, id"
        )
        cell_rows = await self._pool.fetch(
            "SELECT row_asset_id, col_asset_id, value FROM markowitz_correlation"
        )
        return build_matrix(asset_rows, cell_rows)
