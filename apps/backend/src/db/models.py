from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AssetAllocation(BaseModel):
    name: str = Field(
        description=(
            "Canonical subcategory leaf, e.g. 'Deuda Privada', "
            "'Renta Variable US Large Cap'"
        ),
    )
    percentage: float = Field(ge=0, le=100)


class Product(BaseModel):
    id: str = Field(default_factory=lambda: f"prod_{uuid.uuid4().hex[:8]}")
    user_id: str
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    underlying: list[AssetAllocation] = Field(default_factory=list)
    asset_class: list[AssetAllocation] = Field(
        default_factory=list,
        description="List of {name, percentage} allocations summing to 100%."
        " name is one of: inversiones_directas, mercados_privados,"
        " club_deals, mercados_publicos, otros, cash_y_equivalentes",
    )
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    isin: str = ""
    distribution: str = ""
    catalog_product_id: int | None = None


def _check_allocation_sum(allocations: list[AssetAllocation], label: str) -> None:
    if allocations:
        total = sum(a.percentage for a in allocations)
        if abs(total - 100) >= 0.5:
            raise ValueError(f"{label} must sum to 100% (got {total:.1f}%)")


GEOGRAPHIC_FOCUS_OPTIONS = [
    "EEUU",
    "Desarrollados ex-US",
    "Emergentes ex-Perú",
    "Latam ex-Perú",
    "Perú",
]


def _check_geographic_focus(allocations: list[AssetAllocation]) -> None:
    """Enforces the closed vocabulary for `geographic_focus` going forward
    (`sdd/product-catalog-approval` — catalog edit modal geographic focus
    rules). Pre-existing rows with legacy free-text names are untouched
    since this only runs when `geographic_focus` is included in the
    request."""
    names = [a.name for a in allocations]
    invalid = sorted(set(names) - set(GEOGRAPHIC_FOCUS_OPTIONS))
    if invalid:
        raise ValueError(f"Foco(s) geográfico(s) inválido(s): {', '.join(invalid)}")
    if len(names) != len(set(names)):
        raise ValueError("No se permiten focos geográficos duplicados")
    _check_allocation_sum(allocations, "Foco geográfico")


ASSET_CLASS_OPTIONS = [
    "Inmobiliario Directo",
    "Mercados Publicos - Fijo",
    "Mercados Publicos - Variable",
    "Mercados Privados",
    "Club deals",
    "Cash y Otros",
]


def _check_asset_class(allocations: list[AssetAllocation]) -> None:
    """Enforces the closed vocabulary for `product_catalog.asset_class`
    going forward (same rules as `_check_geographic_focus`, mirrored for
    the catalog edit modal's "Clase de activo" field). Pre-existing rows
    with legacy free-text names are untouched since this only runs when
    `asset_class` is included in the request."""
    names = [a.name for a in allocations]
    invalid = sorted(set(names) - set(ASSET_CLASS_OPTIONS))
    if invalid:
        raise ValueError(f"Clase(s) de activo inválida(s): {', '.join(invalid)}")
    if len(names) != len(set(names)):
        raise ValueError("No se permiten clases de activo duplicadas")
    _check_allocation_sum(allocations, "Clase de activo")


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


CURRENCY_OPTIONS = ["Dólares", "Soles"]


def _check_underlying(allocations: list[AssetAllocation]) -> None:
    """Enforces the closed vocabulary for `product_catalog.underlying`
    going forward (same rules as `_check_geographic_focus`/
    `_check_asset_class`, mirrored for the catalog edit modal's
    "Subyacentes" field). Pre-existing rows with legacy free-text names
    are untouched since this only runs when `underlying` is included in
    the request."""
    names = [a.name for a in allocations]
    invalid = sorted(set(names) - set(UNDERLYING_OPTIONS))
    if invalid:
        raise ValueError(f"Subyacente(s) inválido(s): {', '.join(invalid)}")
    if len(names) != len(set(names)):
        raise ValueError("No se permiten subyacentes duplicados")
    _check_allocation_sum(allocations, "Subyacente")


class ProductCreate(BaseModel):
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    underlying: list[AssetAllocation] = Field(default_factory=list)
    asset_class: list[AssetAllocation]
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    isin: str = ""
    distribution: str = ""
    catalog_product_id: int | None = None

    @model_validator(mode="after")
    def _allocations_sum_to_100(self) -> ProductCreate:
        _check_allocation_sum(self.underlying, "Underlying")
        _check_allocation_sum(self.geographic_focus, "Geographic focus")
        _check_allocation_sum(self.asset_class, "Asset class")
        return self


class ProductUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    amount: float | None = None
    underlying: list[AssetAllocation] | None = None
    asset_class: list[AssetAllocation] | None = None
    geographic_focus: list[AssetAllocation] | None = None
    commission: str | None = None
    currency: str | None = None
    administrator: str | None = None
    manager: str | None = None
    liquidity: str | None = None
    return_rate: str | None = None
    isin: str | None = None
    distribution: str | None = None
    catalog_product_id: int | None = None

    @model_validator(mode="after")
    def _allocations_sum_to_100(self) -> ProductUpdate:
        if self.underlying is not None:
            _check_allocation_sum(self.underlying, "Underlying")
        if self.geographic_focus is not None:
            _check_allocation_sum(self.geographic_focus, "Geographic focus")
        if self.asset_class is not None:
            _check_allocation_sum(self.asset_class, "Asset class")
        return self

    @model_validator(mode="after")
    def _validate_isin(self) -> ProductUpdate:
        if self.isin is not None and self.isin.strip() == "":
            raise ValueError("El ISIN es obligatorio")
        return self

    @model_validator(mode="after")
    def _validate_distribution(self) -> ProductUpdate:
        if self.distribution is not None and self.distribution.strip() == "":
            raise ValueError("La distribución es obligatoria")
        return self


class SnapshotCreate(BaseModel):
    """Request body for `POST /portfolio/me/snapshots`
    (`sdd/portfolio-versioning/design.md` — "Request/response models").

    `min_length=1` on `name` makes SNAP-001's "Snapshot creation rejects an
    empty name" scenario a `422` via Pydantic validation alone — no
    handler-level check needed."""

    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class CatalogProduct(BaseModel):
    id: int
    name: str
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    asset_class: list[AssetAllocation] = Field(default_factory=list)
    underlying: list[AssetAllocation] = Field(default_factory=list)
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    isin: str = ""
    distribution: str = ""
    alternative_names: list[str] = Field(default_factory=list)
    administrator_score: int | None = None
    manager_score: int | None = None
    slugs: list[str] = Field(
        default_factory=list,
        description=(
            "Server-computed from name + alternative_names on every "
            "write (normalize_catalog_text: lowercased, unaccented). "
            "Read-only — never accepted from CatalogProductCreate/Update."
        ),
    )
    approved_from_product_id: str | None = None
    approved_at: str | None = None


class CatalogProductCreate(BaseModel):
    """Admin-submitted payload to approve a portfolio product into
    `product_catalog` (`sdd/product-catalog-approval/spec` — "Approve
    Portfolio Product to Catalog"). `name` and `asset_class` are required;
    every other field is optional enrichment."""

    name: str
    asset_class: list[AssetAllocation]
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    underlying: list[AssetAllocation] = Field(default_factory=list)
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    isin: str = ""
    distribution: str = ""
    alternative_names: list[str] = Field(default_factory=list)
    administrator_score: int | None = Field(default=None, ge=1, le=10)
    manager_score: int | None = Field(default=None, ge=1, le=10)
    approved_from_product_id: str | None = None
    catalog_product_id: int | None = None


class CatalogProductUpdate(BaseModel):
    name: str | None = None
    asset_class: list[AssetAllocation] | None = None
    geographic_focus: list[AssetAllocation] | None = None
    underlying: list[AssetAllocation] | None = None
    commission: str | None = None
    currency: str | None = None
    administrator: str | None = None
    manager: str | None = None
    liquidity: str | None = None
    return_rate: str | None = None
    isin: str | None = None
    distribution: str | None = None
    alternative_names: list[str] | None = None
    administrator_score: int | None = Field(default=None, ge=1, le=10)
    manager_score: int | None = Field(default=None, ge=1, le=10)

    @model_validator(mode="after")
    def _validate_geographic_focus(self) -> CatalogProductUpdate:
        if self.geographic_focus is not None:
            _check_geographic_focus(self.geographic_focus)
        return self

    @model_validator(mode="after")
    def _validate_asset_class(self) -> CatalogProductUpdate:
        if self.asset_class is not None:
            _check_asset_class(self.asset_class)
        return self

    @model_validator(mode="after")
    def _validate_underlying(self) -> CatalogProductUpdate:
        if self.underlying is not None:
            _check_underlying(self.underlying)
        return self

    @model_validator(mode="after")
    def _validate_commission(self) -> CatalogProductUpdate:
        if self.commission is not None and self.commission.strip() == "":
            raise ValueError("La comisión es obligatoria")
        return self

    @model_validator(mode="after")
    def _validate_isin(self) -> CatalogProductUpdate:
        if self.isin is not None and self.isin.strip() == "":
            raise ValueError("El ISIN es obligatorio")
        return self

    @model_validator(mode="after")
    def _validate_distribution(self) -> CatalogProductUpdate:
        if self.distribution is not None and self.distribution.strip() == "":
            raise ValueError("La distribución es obligatoria")
        return self

    @model_validator(mode="after")
    def _validate_currency(self) -> CatalogProductUpdate:
        if (
            self.currency is not None
            and self.currency.strip() != ""
            and self.currency not in CURRENCY_OPTIONS
        ):
            raise ValueError(f"Moneda inválida: {self.currency}")
        return self

    @model_validator(mode="after")
    def _validate_administrator_score(self) -> CatalogProductUpdate:
        """Score always travels with its name in one PATCH — the frontend
        sends whatever it displayed (autocompleted from `administrator`, or
        manually entered for "Cash o efectivo"). The backend never re-derives
        it, so it just requires both together."""
        if (
            self.administrator is not None
            and self.administrator.strip() != ""
            and self.administrator_score is None
        ):
            raise ValueError("El score del administrador es obligatorio")
        return self

    @model_validator(mode="after")
    def _validate_manager_score(self) -> CatalogProductUpdate:
        if (
            self.manager is not None
            and self.manager.strip() != ""
            and self.manager_score is None
        ):
            raise ValueError("El score del gestor es obligatorio")
        return self


class Administrator(BaseModel):
    id: int
    name: str
    score: int | None = None
    score_is_fixed: bool = True


class Manager(BaseModel):
    id: int
    name: str
    score: int | None = None


class AdministratorCreate(BaseModel):
    name: str = Field(min_length=1)
    score: int = Field(ge=1, le=10)


class ManagerCreate(BaseModel):
    name: str = Field(min_length=1)
    score: int = Field(ge=1, le=10)


FieldSource = Literal["catalog", "claude_knowledge", "web_search"]


class SearchResult(BaseModel):
    """Unified result of a cascading L1 (catalog) -> L2 (Claude knowledge) ->
    L3 (Tavily web search) product search, with per-field provenance."""

    name: str = ""
    asset_class: list[AssetAllocation] = Field(default_factory=list)
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    underlying: list[AssetAllocation] = Field(default_factory=list)
    catalog_product_id: int | None = None
    primary_source: FieldSource = "catalog"
    provenance: dict[str, FieldSource] = Field(default_factory=dict)
