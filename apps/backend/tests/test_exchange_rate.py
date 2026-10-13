"""Unit tests for the SUNAT exchange-rate provider chain and tool wrapper.

No network: providers are simulated with ``httpx.MockTransport``.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
import pytest

from agent import exchange_rate, tools
from agent.exchange_rate import ExchangeRate, _clear_rate_cache, get_sunat_rate

DECOLECTA_HOST = "api.decolecta.com"
APIS_HOST = "api.apis.net.pe"


@pytest.fixture(autouse=True)
def _reset_cache():
    _clear_rate_cache()
    yield
    _clear_rate_cache()


def _make_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _ok_handler(calls: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.host == DECOLECTA_HOST:
            return httpx.Response(
                200, json={"buy_price": 1, "compra": "3.4", "venta": "3.5", "fecha": "2026-10-12"}
            )
        return httpx.Response(
            200,
            json={
                "origen": "SUNAT",
                "compra": 3.450,
                "venta": 3.457,
                "moneda": "USD",
                "fecha": "2026-10-12",
            },
        )

    return handler


async def test_decolecta_used_when_token_set(monkeypatch):
    monkeypatch.setenv("DECOLECTA_TOKEN", "tok123")
    calls: list[httpx.Request] = []
    async with _make_client(_ok_handler(calls)) as client:
        rate = await get_sunat_rate("2026-10-12", client=client)

    assert rate is not None
    assert (rate.compra, rate.venta, rate.source) == (3.4, 3.5, "decolecta")
    assert rate.date == "2026-10-12"
    assert len(calls) == 1
    assert calls[0].url.host == DECOLECTA_HOST
    assert calls[0].headers["Authorization"] == "Bearer tok123"
    assert calls[0].url.params["date"] == "2026-10-12"


async def test_apis_net_pe_used_without_token(monkeypatch):
    monkeypatch.delenv("DECOLECTA_TOKEN", raising=False)
    calls: list[httpx.Request] = []
    async with _make_client(_ok_handler(calls)) as client:
        rate = await get_sunat_rate("2026-10-12", client=client)

    assert rate == ExchangeRate(
        date="2026-10-12", compra=3.450, venta=3.457, source="apis_net_pe"
    )
    assert [c.url.host for c in calls] == [APIS_HOST]
    assert calls[0].url.params["fecha"] == "2026-10-12"


@pytest.mark.parametrize("failure", ["500", "raise"])
async def test_fallback_to_apis_when_decolecta_fails(monkeypatch, failure):
    monkeypatch.setenv("DECOLECTA_TOKEN", "tok123")
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        if request.url.host == DECOLECTA_HOST:
            if failure == "raise":
                raise httpx.ConnectError("boom")
            return httpx.Response(500)
        return httpx.Response(
            200, json={"compra": 3.45, "venta": 3.46, "fecha": "2026-10-12"}
        )

    async with _make_client(handler) as client:
        rate = await get_sunat_rate("2026-10-12", client=client)

    assert rate is not None and rate.source == "apis_net_pe"
    assert hosts == [DECOLECTA_HOST, APIS_HOST]


async def test_both_fail_returns_none_and_is_not_cached(monkeypatch):
    monkeypatch.setenv("DECOLECTA_TOKEN", "tok123")
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(503)

    async with _make_client(handler) as client:
        assert await get_sunat_rate("2026-10-12", client=client) is None
        first = len(calls)
        assert await get_sunat_rate("2026-10-12", client=client) is None

    assert len(calls) == first * 2  # failure was not cached


async def test_unparseable_body_falls_through(monkeypatch):
    monkeypatch.delenv("DECOLECTA_TOKEN", raising=False)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": True})

    async with _make_client(handler) as client:
        assert await get_sunat_rate("2026-10-12", client=client) is None


async def test_per_date_cache_avoids_second_call(monkeypatch):
    monkeypatch.delenv("DECOLECTA_TOKEN", raising=False)
    calls: list[httpx.Request] = []
    async with _make_client(_ok_handler(calls)) as client:
        first = await get_sunat_rate("2026-10-12", client=client)
        second = await get_sunat_rate("2026-10-12", client=client)
        await get_sunat_rate("2026-10-11", client=client)

    assert first == second
    assert len(calls) == 2  # one per distinct date


async def test_date_defaults_to_today_in_lima(monkeypatch):
    monkeypatch.delenv("DECOLECTA_TOKEN", raising=False)
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["fecha"])
        return httpx.Response(200, json={"compra": 3.4, "venta": 3.5})

    async with _make_client(handler) as client:
        rate = await get_sunat_rate(client=client)

    today = datetime.now(ZoneInfo("America/Lima")).strftime("%Y-%m-%d")
    assert seen == [today]
    assert rate is not None and rate.date == today


async def test_tool_returns_found_shape(monkeypatch):
    async def fake(date=None, *, client=None):
        return ExchangeRate(date="2026-10-12", compra=3.45, venta=3.457, source="apis_net_pe")

    monkeypatch.setattr(tools, "get_sunat_rate", fake)
    result = await tools.get_exchange_rate.ainvoke({"date": "2026-10-12"})
    assert result == {
        "status": "found",
        "date": "2026-10-12",
        "compra": 3.45,
        "venta": 3.457,
        "source": "apis_net_pe",
        "moneda": "USD",
    }


async def test_tool_returns_unavailable_shape(monkeypatch):
    async def fake(date=None, *, client=None):
        return None

    monkeypatch.setattr(tools, "get_sunat_rate", fake)
    result = await tools.get_exchange_rate.ainvoke({"date": "2026-10-12"})
    assert result["status"] == "unavailable"
    assert result["date"] == "2026-10-12"
    assert "SUNAT" in result["message"]


def test_tool_registered():
    assert tools.get_exchange_rate in tools.portfolio_tools
    assert exchange_rate.get_sunat_rate is get_sunat_rate
