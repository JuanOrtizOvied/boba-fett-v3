"""Unit tests (no DB) for the normalized catalog ingestion helpers."""

from __future__ import annotations

import json

import pytest

from db.seed_catalog_normalized import (
    _num,
    admin_row_to_params,
    product_row_to_params,
    series_row_to_params,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ("   ", None),
        (0, 0.0),
        (0.0384, 0.0384),
        (2, 2.0),
        ("3.84%", 3.84),
        ("0.5", 0.5),
        ("1,5", 1.5),
        ("n/a", None),
    ],
)
def test_num(value, expected):
    assert _num(value) == expected


def test_product_row_to_params_maps_columns_and_parses_lists():
    row = (
        "BD-00001",
        " Fund A ",
        "ISIN123",
        "Manager X",
        "mercados_publicos 100%",
        "EEUU 60%, Perú 40%",
        "",
        "USD",
        "Largo plazo",
        "ignored",
        "ignored",
    )
    params = product_row_to_params(row)
    assert params[0] == "BD-00001"
    assert params[1] == "Fund A"
    assert params[2] == "ISIN123"
    assert params[3] == "Manager X"
    assert json.loads(params[4]) == [{"name": "mercados_publicos", "percentage": 100.0}]
    assert json.loads(params[5]) == [
        {"name": "EEUU", "percentage": 60.0},
        {"name": "Perú", "percentage": 40.0},
    ]
    assert json.loads(params[6]) == []
    assert params[7:] == ("USD", "Largo plazo")


def test_product_row_to_params_skips_rows_without_code():
    assert product_row_to_params((None, "x")) is None
    assert product_row_to_params(()) is None


def test_series_row_to_params():
    row = ("BD-00001", "A", "x", "y", 0.0384, 0, 1000, "-5%", 0.12)
    assert series_row_to_params(row) == ("BD-00001", "A", 0.0384, 0.0, 1000.0, -5.0, 0.12)
    assert series_row_to_params((None, "A")) is None


def test_admin_row_to_params():
    row = ("BD-00001", "Admin Co", "A", "x", "y", 0.001, 0.002, "", "USD", 500, 10)
    assert admin_row_to_params(row) == (
        "BD-00001",
        "A",
        "Admin Co",
        0.001,
        0.002,
        None,
        "USD",
        500.0,
        10.0,
    )
    assert admin_row_to_params(("BD-1", "", "A")) is None
