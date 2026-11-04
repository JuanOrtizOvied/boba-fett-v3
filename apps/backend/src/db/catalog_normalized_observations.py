"""Observations for the normalized catalog: what a product is still missing or
holds outside the official lists.

A product is complete when it, each of its series and each administrator of
those series has every field filled, the three allocation fields add up to
100% and their names (and the currencies) belong to the official lists. A
value of 0 is a number like any other and never an observation; only a blank
is. `ticker_isin` is not checked.

The official lists follow the values used in the source Excel, not those of
the older catalog (`db.models`). Observations are computed on read from what
is in the database, so they follow every sync or manual edit with no step of
their own.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from db.catalog_normalized import (
    CatalogProductRow,
    CatalogProductSeries,
    CatalogProductSeriesAdmin,
)
from db.models import AssetAllocation

ASSET_CLASS_OPTIONS = [
    "Mercados Públicos – Fijo",
    "Mercados Públicos – Variable",
    "Mercados Privados",
    "Club Deals",
    "Cash y Otros",
    "Criptos y Commodities",
    "Inmobiliario Directo",
]

GEOGRAPHIC_FOCUS_OPTIONS = [
    "EEUU",
    "Desarrollados ex-US",
    "Emergentes ex-Perú",
    "Latam ex-Perú",
    "Perú",
]

UNDERLYING_OPTIONS = [
    "Acciones Peru",
    "Bonos Corporativos Investment Grade (AAA–BBB)",
    "Bonos High Yield",
    "Bonos Latinoamérica",
    "Bonos Mercados Emergentes (Global)",
    "Bonos Perú",
    "Cash",
    "Club Deals Deuda Privada Peru",
    "Club Deals Deuda Privada Usa y otros",
    "Club Deals Otros Peru",
    "Club Deals Otros USA",
    "Club Deals Real Estate Peru",
    "Club Deals Real Estate USA y Otros",
    "Commodities",
    "Cripto",
    "Desarrollados ex US",
    "Hedge Funds",
    "Infrastructure Privada",
    "Mercados Emergentes ex Perú",
    "Oro",
    "Private Credit  Subordinated",
    "Private Credit Senior",
    "Private Equity",
    "Propiedades Directas Exterior",
    "Propiedades Directas Perú",
    "Real Estate Privado (Fondos)",
    "REITs Públicos",
    "US Large Cap",
    "US Mid & Small Cap",
    "US Treasuries – Largo Plazo",
    "US Treasuries Corto Plazo",
    "Venture Capital",
]

# "por confirmar" is the placeholder the owners use until the real currency is
# known, so it is a valid value and not an observation.
CURRENCY_OPTIONS = ["dólares", "soles", "por confirmar"]

# Same tolerance as the allocation check of the older catalog.
ALLOCATION_SUM_TOLERANCE = 0.5

Level = Literal["product", "series", "admin"]
Issue = Literal["empty", "allocation_sum", "not_in_list", "no_series", "no_administrators"]


class Observation(BaseModel):
    """One problem. `level` says where it is: on the product itself, on one of
    its series (`series`) or on one administrator of a series (`series` and
    `administrator`). `field` is the API name of the field, or `series` /
    `administrators` for a product or series with no children. `value` is the
    offending name or the allocation total ("" for a blank)."""

    level: Level
    field: str
    issue: Issue
    value: str = ""
    series: str | None = None
    administrator: str | None = None


class ProductObservations(BaseModel):
    code: str
    observations: list[Observation]


def _blank(value: str | None) -> bool:
    return not (value or "").strip()


def _allocation_observations(
    field: str, rows: list[AssetAllocation], official: list[str]
) -> list[Observation]:
    if not rows:
        return [Observation(level="product", field=field, issue="empty")]
    found: list[Observation] = []
    total = sum(row.percentage for row in rows)
    if abs(total - 100) >= ALLOCATION_SUM_TOLERANCE:
        found.append(
            Observation(level="product", field=field, issue="allocation_sum", value=f"{total:g}%")
        )
    for row in rows:
        if row.name not in official:
            found.append(
                Observation(level="product", field=field, issue="not_in_list", value=row.name)
            )
    return found


def _text_observations(field: str, value: str, official: list[str], **where) -> list[Observation]:
    if _blank(value):
        return [Observation(field=field, issue="empty", **where)]
    if value not in official:
        return [Observation(field=field, issue="not_in_list", value=value, **where)]
    return []


def _admin_observations(
    series: CatalogProductSeries, admin: CatalogProductSeriesAdmin
) -> list[Observation]:
    where = {"level": "admin", "series": series.series, "administrator": admin.administrator}
    found = [
        Observation(field=field, issue="empty", **where)
        for field in (
            "custody_fee",
            "buy_commission",
            "sell_commission",
            "minimum_usd",
            "min_commission_usd",
        )
        if getattr(admin, field) is None
    ]
    found += _text_observations(
        "billing_currency", admin.billing_currency, CURRENCY_OPTIONS, **where
    )
    return found


def _series_observations(series: CatalogProductSeries) -> list[Observation]:
    where = {"level": "series", "series": series.series}
    found = [Observation(field="series", issue="empty", **where)] if _blank(series.series) else []
    found += [
        Observation(field=field, issue="empty", **where)
        for field in ("management_fee_ter", "flows_min", "flows_max", "return_min", "return_max")
        if getattr(series, field) is None
    ]
    if not series.administrators:
        found.append(Observation(field="administrators", issue="no_administrators", **where))
    for admin in series.administrators:
        found += _admin_observations(series, admin)
    return found


def product_observations(product: CatalogProductRow) -> list[Observation]:
    """Every observation of one product, its series and their administrators,
    in screen order: product fields, then each series with its administrators.
    `product` must carry its series and administrators."""
    found: list[Observation] = []
    if _blank(product.manager):
        found.append(Observation(level="product", field="manager", issue="empty"))
    found += _text_observations("currency", product.currency, CURRENCY_OPTIONS, level="product")
    if _blank(product.investment_horizon):
        found.append(Observation(level="product", field="investment_horizon", issue="empty"))
    found += _allocation_observations("asset_class", product.asset_class, ASSET_CLASS_OPTIONS)
    found += _allocation_observations(
        "geographic_focus", product.geographic_focus, GEOGRAPHIC_FOCUS_OPTIONS
    )
    found += _allocation_observations("underlying", product.underlying, UNDERLYING_OPTIONS)
    if not product.series:
        found.append(Observation(level="product", field="series", issue="no_series"))
    for series in product.series:
        found += _series_observations(series)
    return found


def catalog_observations(products: list[CatalogProductRow]) -> list[ProductObservations]:
    """Only the products that have at least one observation, in input order."""
    result = []
    for product in products:
        found = product_observations(product)
        if found:
            result.append(ProductObservations(code=product.code, observations=found))
    return result
