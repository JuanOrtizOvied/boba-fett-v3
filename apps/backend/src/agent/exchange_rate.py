"""SUNAT official USD->PEN exchange rate via a resilient provider chain.

Providers republish SUNAT's exact daily figures:
1. Decolecta (only when ``DECOLECTA_TOKEN`` is set).
2. apis.net.pe v1 (no token).

If every provider fails, ``get_sunat_rate`` returns ``None`` — a rate is
never invented. Successful results are cached per date (published rates
are immutable); failures are never cached.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_DECOLECTA_URL = "https://api.decolecta.com/v1/tipo-cambio/sunat"
_APIS_NET_PE_URL = "https://api.apis.net.pe/v1/tipo-cambio-sunat"
_TIMEOUT = httpx.Timeout(8.0)

_RATE_CACHE: dict[str, ExchangeRate] = {}


class ExchangeRate(BaseModel):
    date: str
    compra: float
    venta: float
    source: str
    moneda: str = "USD"


def _clear_rate_cache() -> None:
    _RATE_CACHE.clear()


def today_lima() -> str:
    return datetime.now(ZoneInfo("America/Lima")).strftime("%Y-%m-%d")


def _parse(data: dict, date: str, source: str) -> ExchangeRate:
    return ExchangeRate(
        date=str(data.get("fecha") or data.get("date") or date),
        compra=float(data["compra"]),
        venta=float(data["venta"]),
        source=source,
    )


async def _fetch_decolecta(client: httpx.AsyncClient, date: str) -> ExchangeRate | None:
    token = os.environ.get("DECOLECTA_TOKEN")
    if not token:
        return None
    try:
        resp = await client.get(
            _DECOLECTA_URL,
            params={"date": date},
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        if resp.status_code != 200:
            return None
        return _parse(resp.json(), date, "decolecta")
    except Exception:
        logger.warning("Decolecta exchange-rate lookup failed", exc_info=True)
        return None


async def _fetch_apis_net_pe(client: httpx.AsyncClient, date: str) -> ExchangeRate | None:
    try:
        resp = await client.get(
            _APIS_NET_PE_URL,
            params={"fecha": date},
            headers={"Accept": "application/json"},
        )
        if resp.status_code != 200:
            return None
        return _parse(resp.json(), date, "apis_net_pe")
    except Exception:
        logger.warning("apis.net.pe exchange-rate lookup failed", exc_info=True)
        return None


async def get_sunat_rate(
    date: str | None = None, *, client: httpx.AsyncClient | None = None
) -> ExchangeRate | None:
    """Return SUNAT's official rate for ``date`` (default: today, Lima)."""
    date = date or today_lima()
    cached = _RATE_CACHE.get(date)
    if cached is not None:
        return cached

    async def _run(c: httpx.AsyncClient) -> ExchangeRate | None:
        for fetch in (_fetch_decolecta, _fetch_apis_net_pe):
            rate = await fetch(c, date)
            if rate is not None:
                return rate
        return None

    if client is not None:
        rate = await _run(client)
    else:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
            rate = await _run(c)

    if rate is not None:
        _RATE_CACHE[date] = rate
    return rate
