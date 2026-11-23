"""The Markowitz correlation matrix of asset classes as the admin view reads and edits it.

Two tables: `markowitz_asset` (one row per asset class; `position` orders both the rows and
the columns) and `markowitz_correlation` (one row per cell, both directions stored, so a
pair that is not symmetric shows). The database keeps the range of a value (-1 to 1) and the
diagonal (always 1); that the matrix is complete is kept by the code that writes it, inside
one transaction under an advisory lock.

There is no way to delete an asset or a cell. The risk lambda still reads its own constant,
not these tables: nothing here changes a score yet.
"""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterable, Mapping
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any

import asyncpg
from pydantic import (
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from db.catalog_normalized import slugify_name

# One advisory lock for every write, so two writers cannot both pass a check (name, slug,
# completeness) and leave a half matrix.
_LOCK_KEY = 8_401_002_020

MAX_NAME = 200
MAX_SLUGS = 30
MAX_SLUG = 100
MAX_CORRELATIONS = 500

Value = Annotated[Decimal, Field(ge=-1, le=1, max_digits=5, decimal_places=4)]
Slug = Annotated[str, StringConstraints(max_length=MAX_SLUG)]


def clean_name(value: str) -> str:
    """Trimmed, with every run of spaces collapsed to one."""
    return " ".join(value.split())


def fold(value: str) -> str:
    """Lower case, no accents, spaces collapsed: what two names are compared by."""
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
    """The slugs of an asset: the JSONB array, or empty when it is not a list of strings."""
    value = json.loads(raw) if isinstance(raw, str) else raw
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return list(value)
    return []


def _a_number(value: Any) -> Any:
    """A correlation must arrive as a JSON number, not as text or a boolean."""
    if isinstance(value, bool) or isinstance(value, str):
        raise ValueError("value must be a number")
    return value


# -- Read models ---------------------------------------------------------------


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


class MarkowitzCell(BaseModel):
    row_id: int
    col_id: int
    value: float
    updated_at: datetime


# -- Request models ------------------------------------------------------------


class MarkowitzCellUpdate(BaseModel):
    """Set one cell; with `both_directions` also the opposite one. The diagonal is not
    editable."""

    row_id: int
    col_id: int
    value: Value
    both_directions: bool = False

    @field_validator("value", mode="before")
    @classmethod
    def _value(cls, value: Any) -> Any:
        return _a_number(value)

    @model_validator(mode="after")
    def _not_the_diagonal(self) -> MarkowitzCellUpdate:
        if self.row_id == self.col_id:
            raise ValueError("the diagonal cannot be edited")
        return self


class MarkowitzCorrelation(BaseModel):
    asset_id: int
    value: Value

    @field_validator("value", mode="before")
    @classmethod
    def _value(cls, value: Any) -> Any:
        return _a_number(value)


def _checked_name(value: str) -> str:
    value = clean_name(value)
    if not value or len(value) > MAX_NAME:
        raise ValueError(f"name must have 1 to {MAX_NAME} characters")
    return value


class MarkowitzAssetCreate(BaseModel):
    """A new asset with one value against every existing asset (written in both
    directions). Its own diagonal is 1."""

    name: str
    slugs: list[Slug] = Field(default_factory=list, max_length=MAX_SLUGS)
    correlations: list[MarkowitzCorrelation] = Field(max_length=MAX_CORRELATIONS)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _checked_name(value)


class MarkowitzAssetUpdate(BaseModel):
    """Only the fields sent change; neither can be null."""

    name: str | None = None
    slugs: list[Slug] | None = Field(default=None, max_length=MAX_SLUGS)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return None if value is None else _checked_name(value)

    @model_validator(mode="after")
    def _not_null(self) -> MarkowitzAssetUpdate:
        for field in ("name", "slugs"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


# -- Errors --------------------------------------------------------------------


class MarkowitzNotFoundError(Exception):
    """An asset id that does not exist."""


class MarkowitzNameExistsError(Exception):
    """The name is taken by another asset, ignoring case, accents and spaces."""


class MarkowitzSlugTakenError(Exception):
    """A slug that another asset already holds."""

    def __init__(self, slug: str, holder: str) -> None:
        super().__init__(f"{slug} is held by {holder}")
        self.slug = slug
        self.holder = holder


class MarkowitzIncompleteError(Exception):
    """The values of a new asset do not name every existing asset exactly once."""

    def __init__(self, *, missing: list[int], unknown: list[int], repeated: list[int]) -> None:
        super().__init__("the values do not match the existing assets")
        self.missing = missing
        self.unknown = unknown
        self.repeated = repeated


# -- Reading -------------------------------------------------------------------


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


def _to_asset(row: asyncpg.Record) -> MarkowitzAsset:
    return MarkowitzAsset(
        id=row["id"],
        name=row["name"],
        slugs=_stored_slugs(row["slugs"]),
        position=row["position"],
        updated_at=row["updated_at"],
    )


_ASSET_COLUMNS = "id, name, slugs, position, updated_at"


class MarkowitzRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def get_matrix(self) -> MarkowitzMatrix:
        """The whole matrix and the pairs to review. The assets are read first, so a cell
        that belongs to an asset added a moment later is left out instead of unbalancing
        the square."""
        asset_rows = await self._pool.fetch(
            f"SELECT {_ASSET_COLUMNS} FROM markowitz_asset ORDER BY position, id"
        )
        cell_rows = await self._pool.fetch(
            "SELECT row_asset_id, col_asset_id, value FROM markowitz_correlation"
        )
        return build_matrix(asset_rows, cell_rows)

    # -- Writing ---------------------------------------------------------------

    async def set_cell(self, data: MarkowitzCellUpdate) -> list[MarkowitzCell]:
        """Set the cell (and the opposite one with `both_directions`) in one transaction.
        A value a cell already has is left alone, with its date. Returns the cells asked
        for, as they are stored."""
        pairs = [(data.row_id, data.col_id)]
        if data.both_directions:
            pairs.append((data.col_id, data.row_id))
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEY)
            found = await conn.fetchval(
                "SELECT count(*) FROM markowitz_asset WHERE id = ANY($1::int[])",
                [data.row_id, data.col_id],
            )
            if found != 2:
                raise MarkowitzNotFoundError
            for row_id, col_id in pairs:
                await conn.execute(
                    "INSERT INTO markowitz_correlation AS c (row_asset_id, col_asset_id, value) "
                    "VALUES ($1, $2, $3) "
                    "ON CONFLICT (row_asset_id, col_asset_id) DO UPDATE "
                    "SET value = EXCLUDED.value, updated_at = now() "
                    "WHERE c.value IS DISTINCT FROM EXCLUDED.value",
                    row_id,
                    col_id,
                    data.value,
                )
            rows = [
                await conn.fetchrow(
                    "SELECT row_asset_id, col_asset_id, value, updated_at "
                    "FROM markowitz_correlation WHERE row_asset_id = $1 AND col_asset_id = $2",
                    row_id,
                    col_id,
                )
                for row_id, col_id in pairs
            ]
        return [
            MarkowitzCell(
                row_id=r["row_asset_id"],
                col_id=r["col_asset_id"],
                value=float(r["value"]),
                updated_at=r["updated_at"],
            )
            for r in rows
        ]

    @staticmethod
    def _check_slugs(slugs: list[str], others: list[asyncpg.Record], own: list[str]) -> None:
        """Refuse a slug another asset holds. A slug the asset already holds is not new."""
        held: dict[str, str] = {}
        for other in others:
            for slug in _stored_slugs(other["slugs"]):
                held.setdefault(slug, other["name"])
        for slug in slugs:
            if slug not in own and slug in held:
                raise MarkowitzSlugTakenError(slug, held[slug])

    @staticmethod
    def _check_name(name: str, others: list[asyncpg.Record]) -> None:
        wanted = fold(name)
        if any(fold(other["name"]) == wanted for other in others):
            raise MarkowitzNameExistsError

    async def create_asset(self, data: MarkowitzAssetCreate) -> MarkowitzAsset:
        """Add an asset at the end, with its values against every existing asset in both
        directions and its own diagonal, all or nothing."""
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEY)
            existing = await conn.fetch(f"SELECT {_ASSET_COLUMNS} FROM markowitz_asset")
            self._check_name(data.name, existing)

            ids = {row["id"] for row in existing}
            given = [c.asset_id for c in data.correlations]
            repeated = sorted({i for i in given if given.count(i) > 1})
            unknown = sorted(set(given) - ids)
            missing = sorted(ids - set(given))
            if repeated or unknown or missing:
                raise MarkowitzIncompleteError(missing=missing, unknown=unknown, repeated=repeated)

            slugs = normalize_slugs(data.name, data.slugs)
            self._check_slugs(slugs, existing, own=[])
            try:
                row = await conn.fetchrow(
                    "INSERT INTO markowitz_asset (name, slugs, position) VALUES "
                    "($1, $2::jsonb, (SELECT COALESCE(MAX(position), 0) + 1 FROM markowitz_asset)) "
                    f"RETURNING {_ASSET_COLUMNS}",
                    data.name,
                    json.dumps(slugs),
                )
            except asyncpg.UniqueViolationError:
                raise MarkowitzNameExistsError from None
            new_id = row["id"]
            cells = [(new_id, new_id, Decimal(1))]
            for c in data.correlations:
                cells.append((new_id, c.asset_id, c.value))
                cells.append((c.asset_id, new_id, c.value))
            await conn.executemany(
                "INSERT INTO markowitz_correlation (row_asset_id, col_asset_id, value) "
                "VALUES ($1, $2, $3)",
                cells,
            )
        return _to_asset(row)

    async def update_asset(self, asset_id: int, data: MarkowitzAssetUpdate) -> MarkowitzAsset:
        """Change the name and/or the slugs of an asset. No cell and no position changes."""
        sent = data.model_fields_set
        async with self._pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", _LOCK_KEY)
            rows = await conn.fetch(f"SELECT {_ASSET_COLUMNS} FROM markowitz_asset")
            current = next((r for r in rows if r["id"] == asset_id), None)
            if current is None:
                raise MarkowitzNotFoundError
            others = [r for r in rows if r["id"] != asset_id]

            name = data.name if "name" in sent and data.name is not None else current["name"]
            if "name" in sent:
                self._check_name(name, others)
            own = _stored_slugs(current["slugs"])
            slugs = own
            if "slugs" in sent and data.slugs is not None:
                slugs = normalize_slugs(name, data.slugs)
            elif "name" in sent:
                slugs = normalize_slugs(name, own)
            self._check_slugs(slugs, others, own=own)
            try:
                row = await conn.fetchrow(
                    "UPDATE markowitz_asset SET name = $1, slugs = $2::jsonb, updated_at = now() "
                    f"WHERE id = $3 RETURNING {_ASSET_COLUMNS}",
                    name,
                    json.dumps(slugs),
                    asset_id,
                )
            except asyncpg.UniqueViolationError:
                raise MarkowitzNameExistsError from None
        return _to_asset(row)
