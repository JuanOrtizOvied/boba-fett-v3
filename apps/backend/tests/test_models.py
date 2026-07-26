"""Tests for Pydantic portfolio models (`db.models`)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_asset_allocation_valid():
    from db.models import AssetAllocation

    allocation = AssetAllocation(name="Deuda privada", percentage=45.5)

    assert allocation.name == "Deuda privada"
    assert allocation.percentage == 45.5


@pytest.mark.parametrize("percentage", [-1, 100.1, 150])
def test_asset_allocation_rejects_out_of_range_percentage(percentage):
    from db.models import AssetAllocation

    with pytest.raises(ValidationError):
        AssetAllocation(name="Deuda privada", percentage=percentage)


def test_asset_allocation_requires_name():
    from db.models import AssetAllocation

    with pytest.raises(ValidationError):
        AssetAllocation(percentage=50)


def test_product_valid_generates_default_id():
    from db.models import AssetAllocation, Product

    product = Product(
        user_id="usr_123",
        name="BlackRock Private Credit Fund",
        amount=50000,
        asset_class=[AssetAllocation(name="mercados_privados", percentage=100)],
    )

    assert product.id.startswith("prod_")
    assert product.user_id == "usr_123"
    assert product.name == "BlackRock Private Credit Fund"
    assert product.provider == ""
    assert product.underlying == []
    assert product.catalog_product_id is None


def test_product_accepts_explicit_underlying():
    from db.models import AssetAllocation, Product

    product = Product(
        user_id="usr_123",
        name="Multi-asset fund",
        amount=10000,
        asset_class=[AssetAllocation(name="mercados_publicos", percentage=100)],
        underlying=[
            AssetAllocation(name="RV US Large Cap", percentage=60),
            AssetAllocation(name="RF Corporate", percentage=40),
        ],
    )

    assert len(product.underlying) == 2
    assert sum(a.percentage for a in product.underlying) == 100


@pytest.mark.parametrize("amount", [0, -1, -100.5])
def test_product_rejects_non_positive_amount(amount):
    from db.models import AssetAllocation, Product

    with pytest.raises(ValidationError):
        Product(
            user_id="usr_123",
            name="Fund",
            amount=amount,
            asset_class=[AssetAllocation(name="cash_y_equivalentes", percentage=100)],
        )


def test_product_requires_name_and_asset_class():
    from db.models import Product

    with pytest.raises(ValidationError):
        Product(user_id="usr_123", amount=100)


def test_product_create_valid():
    from db.models import AssetAllocation, ProductCreate

    data = ProductCreate(
        name="Fund A",
        amount=1000,
        asset_class=[AssetAllocation(name="inversiones_directas", percentage=100)],
    )

    assert data.name == "Fund A"
    assert data.provider == ""
    assert data.underlying == []
    assert data.catalog_product_id is None


@pytest.mark.parametrize("amount", [0, -50])
def test_product_create_rejects_non_positive_amount(amount):
    from db.models import AssetAllocation, ProductCreate

    with pytest.raises(ValidationError):
        ProductCreate(
            name="Fund A",
            amount=amount,
            asset_class=[AssetAllocation(name="inversiones_directas", percentage=100)],
        )


def test_product_create_requires_name():
    from db.models import AssetAllocation, ProductCreate

    with pytest.raises(ValidationError):
        ProductCreate(amount=100, asset_class=[AssetAllocation(name="inversiones_directas", percentage=100)])


def test_product_update_all_fields_optional():
    from db.models import ProductUpdate

    update = ProductUpdate()

    assert update.name is None
    assert update.provider is None
    assert update.amount is None
    assert update.asset_class is None
    assert update.underlying is None


def test_product_update_partial_fields():
    from db.models import AssetAllocation, ProductUpdate

    update = ProductUpdate(
        amount=2500,
        asset_class=[AssetAllocation(name="cash_y_equivalentes", percentage=100)],
    )

    assert update.amount == 2500
    assert update.asset_class == [AssetAllocation(name="cash_y_equivalentes", percentage=100)]
    assert update.name is None


def test_product_update_underlying_replaces_full_list():
    from db.models import AssetAllocation, ProductUpdate

    update = ProductUpdate(
        underlying=[AssetAllocation(name="Cripto", percentage=100)]
    )

    assert update.underlying is not None
    assert len(update.underlying) == 1
    assert update.underlying[0].name == "Cripto"


def test_catalog_product_asset_class_defaults_empty():
    from db.models import CatalogProduct

    product = CatalogProduct(id=1, name="Vanguard Total World Stock ETF")

    assert product.asset_class == []


def test_catalog_product_accepts_explicit_asset_class():
    from db.models import AssetAllocation, CatalogProduct

    product = CatalogProduct(
        id=2,
        name="US Treasury Bond Fund",
        asset_class=[AssetAllocation(name="mercados_publicos", percentage=100)],
    )

    assert product.asset_class == [AssetAllocation(name="mercados_publicos", percentage=100)]


def test_search_result_defaults_are_all_empty():
    from db.models import SearchResult

    result = SearchResult()

    assert result.name == ""
    assert result.asset_class == []
    assert result.geographic_focus == []
    assert result.commission == ""
    assert result.currency == ""
    assert result.administrator == ""
    assert result.manager == ""
    assert result.liquidity == ""
    assert result.return_rate == ""
    assert result.catalog_product_id is None
    assert result.primary_source == "catalog"
    assert result.provenance == {}


def test_search_result_tracks_per_field_provenance():
    from db.models import SearchResult

    result = SearchResult(
        name="Vanguard Total World Stock ETF",
        commission="0.07%",
        primary_source="claude_knowledge",
        provenance={"name": "catalog", "commission": "claude_knowledge"},
    )

    assert result.provenance["name"] == "catalog"
    assert result.provenance["commission"] == "claude_knowledge"


def test_search_result_provenance_defaults_are_independent_instances():
    from db.models import SearchResult

    first = SearchResult()
    second = SearchResult()
    first.provenance["name"] = "catalog"

    assert second.provenance == {}
