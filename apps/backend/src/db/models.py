from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class AssetAllocation(BaseModel):
    name: str = Field(description="Asset class name, e.g. 'Deuda privada'")
    percentage: float = Field(ge=0, le=100)


class Product(BaseModel):
    id: str = Field(default_factory=lambda: f"prod_{uuid.uuid4().hex[:8]}")
    user_id: str
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    category: str = Field(description="One of: directas, privados, club, publicos, otros, cash")
    subcategory: str = ""
    composition: list[AssetAllocation] = Field(default_factory=list)
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""


class ProductCreate(BaseModel):
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    category: str
    subcategory: str = ""
    composition: list[AssetAllocation] = Field(default_factory=list)
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""


class ProductUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    amount: float | None = None
    category: str | None = None
    subcategory: str | None = None
    composition: list[AssetAllocation] | None = None
    asset_class: str | None = None
    geographic_focus: str | None = None
    underlying: str | None = None
    commission: str | None = None
    currency: str | None = None
    administrator: str | None = None
    manager: str | None = None
    liquidity: str | None = None
    return_rate: str | None = None


class CatalogProduct(BaseModel):
    id: int
    name: str
    geographic_focus: str = ""
    asset_class: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    subcategory: str = ""
    alternative_names: list[str] = Field(default_factory=list)
    approved_from_product_id: str | None = None
    approved_at: str | None = None


class CatalogProductCreate(BaseModel):
    """Admin-submitted payload to approve a portfolio product into
    `product_catalog` (`sdd/product-catalog-approval/spec` — "Approve
    Portfolio Product to Catalog"). `name` and `category` are required;
    every other field is optional enrichment."""

    name: str
    category: str
    subcategory: str = ""
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    alternative_names: list[str] = Field(default_factory=list)
    approved_from_product_id: str | None = None


class CatalogProductUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    subcategory: str | None = None
    asset_class: str | None = None
    geographic_focus: str | None = None
    underlying: str | None = None
    commission: str | None = None
    currency: str | None = None
    administrator: str | None = None
    manager: str | None = None
    liquidity: str | None = None
    return_rate: str | None = None
    alternative_names: list[str] | None = None


FieldSource = Literal["catalog", "claude_knowledge", "web_search"]


class SearchResult(BaseModel):
    """Unified result of a cascading L1 (catalog) -> L2 (Claude knowledge) ->
    L3 (Tavily web search) product search, with per-field provenance."""

    name: str = ""
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    subcategory: str = ""
    primary_source: FieldSource = "catalog"
    provenance: dict[str, FieldSource] = Field(default_factory=dict)
