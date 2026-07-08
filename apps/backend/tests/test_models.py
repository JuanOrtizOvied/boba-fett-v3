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
    from db.models import Product

    product = Product(
        user_id="usr_123",
        name="BlackRock Private Credit Fund",
        amount=50000,
        category="privados",
    )

    assert product.id.startswith("prod_")
    assert product.user_id == "usr_123"
    assert product.name == "BlackRock Private Credit Fund"
    assert product.provider == ""
    assert product.composition == []


def test_product_accepts_explicit_composition():
    from db.models import AssetAllocation, Product

    product = Product(
        user_id="usr_123",
        name="Multi-asset fund",
        amount=10000,
        category="publicos",
        composition=[
            AssetAllocation(name="RV US Large Cap", percentage=60),
            AssetAllocation(name="RF Corporate", percentage=40),
        ],
    )

    assert len(product.composition) == 2
    assert sum(a.percentage for a in product.composition) == 100


@pytest.mark.parametrize("amount", [0, -1, -100.5])
def test_product_rejects_non_positive_amount(amount):
    from db.models import Product

    with pytest.raises(ValidationError):
        Product(user_id="usr_123", name="Fund", amount=amount, category="cash")


def test_product_requires_name_and_category():
    from db.models import Product

    with pytest.raises(ValidationError):
        Product(user_id="usr_123", amount=100)


def test_product_create_valid():
    from db.models import ProductCreate

    data = ProductCreate(name="Fund A", amount=1000, category="directas")

    assert data.name == "Fund A"
    assert data.provider == ""
    assert data.composition == []


@pytest.mark.parametrize("amount", [0, -50])
def test_product_create_rejects_non_positive_amount(amount):
    from db.models import ProductCreate

    with pytest.raises(ValidationError):
        ProductCreate(name="Fund A", amount=amount, category="directas")


def test_product_create_requires_name():
    from db.models import ProductCreate

    with pytest.raises(ValidationError):
        ProductCreate(amount=100, category="directas")


def test_product_update_all_fields_optional():
    from db.models import ProductUpdate

    update = ProductUpdate()

    assert update.name is None
    assert update.provider is None
    assert update.amount is None
    assert update.category is None
    assert update.composition is None


def test_product_update_partial_fields():
    from db.models import ProductUpdate

    update = ProductUpdate(amount=2500, category="cash")

    assert update.amount == 2500
    assert update.category == "cash"
    assert update.name is None


def test_product_update_composition_replaces_full_list():
    from db.models import AssetAllocation, ProductUpdate

    update = ProductUpdate(
        composition=[AssetAllocation(name="Cripto", percentage=100)]
    )

    assert update.composition is not None
    assert len(update.composition) == 1
    assert update.composition[0].name == "Cripto"
