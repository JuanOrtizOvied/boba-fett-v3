"""Pydantic models for the v2 catalog (read side).

Rates and percentages of series and administrator links are fractions, as in
the workbook (0.0384 is 3.84%); the UI formats them as percentages. The
composite columns of a product (`asset_class`, `geographic_focus`,
`underlying`) hold percentages on a 0-100 scale.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Allocation(BaseModel):
    name: str
    percentage: float


class AdministratorLink(BaseModel):
    """One administrator that offers one series of a product."""

    id: int
    administrator_id: int
    administrator: str
    administrator_score: int | None = None
    custody: float | None = None
    buy_commission: float | None = None
    sell_commission: float | None = None
    minimum_usd: float | None = None
    min_commission_usd: float | None = None
    is_deleted: bool = False


class Series(BaseModel):
    id: int
    series: str
    ter: float | None = None
    flows_min: float | None = None
    flows_max: float | None = None
    return_min: float | None = None
    return_max: float | None = None
    is_deleted: bool = False
    administrators: list[AdministratorLink] = Field(default_factory=list)


class CatalogV2Product(BaseModel):
    id: int
    codigo: str
    name: str
    isin: str = ""
    manager_id: int | None = None
    manager: str = ""
    manager_score: int | None = None
    asset_class: list[Allocation] = Field(default_factory=list)
    geographic_focus: list[Allocation] = Field(default_factory=list)
    underlying: list[Allocation] = Field(default_factory=list)
    currency: str = ""
    investment_horizon: str = ""
    is_deleted: bool = False


class CatalogV2ProductDetail(CatalogV2Product):
    series: list[Series] = Field(default_factory=list)


class AdministratorV2(BaseModel):
    id: int
    name: str
    score: int | None = None
    score_is_fixed: bool = True


class ManagerV2(BaseModel):
    id: int
    name: str
    score: int | None = None
