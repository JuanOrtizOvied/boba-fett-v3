from __future__ import annotations

import uuid

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
    composition: list[AssetAllocation] = Field(default_factory=list)


class ProductCreate(BaseModel):
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    category: str
    composition: list[AssetAllocation] = Field(default_factory=list)


class ProductUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    amount: float | None = None
    category: str | None = None
    composition: list[AssetAllocation] | None = None


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
