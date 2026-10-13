# Feature: Agent USD↔PEN conversion using SUNAT official rate

- **Feature ID:** `agent-fx-sunat`
- **File locator:** `odd/tasks/agent-fx-sunat.md`
- **Engram mirror topic:** `odd/agent-fx-sunat/tasks`
- **Branch:** `feat/agent-fx-sunat` (off `main`)
- **TDD mode:** strict. Backend runner: `apps/backend/.venv/bin/python -m pytest -q`
  (global python 3.10 breaks on vcr/urllib3). New tests are UNIT tests (mocked
  httpx via `httpx.MockTransport`) — no DB / no network.

## Objective

When the conversational agent converts dollars to/from soles (USD ↔ PEN), it must
use SUNAT's **official daily exchange rate** (compra/venta), fetched live, and NEVER
invent or estimate a rate. User-provided reference:
`https://e-consulta.sunat.gob.pe/cl-at-ittipcam/tcS01Alias`.

## Research outcome (why not scrape SUNAT directly)

The SUNAT page is a JSF/PrimeFaces app — no JSON/REST API; the calendar is a stateful
full-page POST with a `ViewState` token behind WAF. Scraping it is fragile and
high-maintenance. Third-party APIs **republish SUNAT's exact figures** (`origen: "SUNAT"`):
- `apis.net.pe/v1/tipo-cambio-sunat?fecha=YYYY-MM-DD` → `{compra, venta, fecha, origen, moneda}` — NO token, works today, but vendor migrated to Decolecta (deprecation risk).
- `api.decolecta.com/v1/tipo-cambio/sunat?date=YYYY-MM-DD` → same data, requires a free Bearer token, actively maintained.

## Design decision (user-approved: "Cadena resiliente")

Provider chain inside a new FX module, same numbers from SUNAT either way:
1. **Decolecta** when `DECOLECTA_TOKEN` env var is set (preferred, maintained).
2. **apis.net.pe v1** (no token) otherwise / on Decolecta failure.
3. If both fail → return "unavailable" (the agent tells the user and offers the SUNAT
   page; it NEVER invents a rate).

- Per-date in-memory cache (the published rate is immutable once published).
- `httpx.AsyncClient` with a short timeout; each provider wrapped in try/except so one
  failure falls through to the next.
- Date defaults to today in `America/Lima`; explicit `date` (YYYY-MM-DD) passes through.
- Published value is the SBS **previous-business-day** close (per the SUNAT note); on
  weekends/holidays the API carries over the last business day — the tool returns
  whatever SUNAT published for that date.

### compra vs venta convention (for the prompt)

Standard FX-desk convention, stated in the prompt (not financial advice):
- USD → PEN (you hold dollars, want soles): use **compra**.
- PEN → USD (you hold soles, want dollars): use **venta**.
The agent always shows the rate used, the date, and that the source is SUNAT.

## Files

- NEW `apps/backend/src/agent/exchange_rate.py` — provider chain + cache + `ExchangeRate` model.
- MOD `apps/backend/src/agent/tools.py` — `@tool get_exchange_rate`, added to `portfolio_tools`.
- MOD `apps/backend/src/agent/prompts.py` — new "TIPO DE CAMBIO (USD ↔ PEN)" section.
- NEW `apps/backend/tests/test_exchange_rate.py` — unit tests (MockTransport).

Untouched: `product_catalog`, flat `/admin/catalog`, the search cascade, the frontend.
No new DB table, no migration, no new secret required to run (token is optional).

## Tasks

- [x] **T-A — FX module + tool + prompt (writer, strict TDD).** DONE.
  Created `agent/exchange_rate.py` (`ExchangeRate` model, `get_sunat_rate`, `today_lima`,
  per-date `_RATE_CACHE` + `_clear_rate_cache`); `@tool get_exchange_rate` added to
  `portfolio_tools`; TIPO DE CAMBIO section added to `prompts.py` (between REBALANCEO and
  CUMPLIMIENTO). Tests in `tests/test_exchange_rate.py`. Also touched `tests/test_tools.py`
  (the hard-coded "exports eight tools" count/name list → nine, since a 9th tool was added).
- [x] **T-B — Verify + commit.** Orchestrator spot-checked (re-ran tests + ruff) and read
  the module + tests + diffs. Commit `8739f52`.
- [x] **T-C — Currency-identity guardrails (prompt only, direct inline).** Reported bug
  (ODD §2.4): the agent fabricated a product's currency variant (e.g. "Coril Retail en
  dólares") by copying a soles product's fields, and treated a currency word in a product
  NAME as a conversion request. Fix in `prompts.py` only:
  (1) in the search rules — the product's moneda is part of its identity; search the name
  as-is, never "convert" it; `currency` always comes from `search_product`; NEVER fabricate
  a currency variant by copying fields (a USD and a PEN product are DISTINCT and must be
  verified separately). (2) in the TIPO DE CAMBIO section — `get_exchange_rate` converts
  MONEY AMOUNTS only, never a product's currency / never creates a product.
  TDD note: a system-prompt wording guardrail has no meaningful RED/GREEN (LLM behavior);
  verified by rebuilding the prompt (guardrail strings present), `ruff` clean, and the
  existing suite still green. No test added (a content-string assertion would be brittle
  gaming, not behavioral coverage).

## Acceptance criteria

- New unit tests green; `ruff check src/` clean. ✓
- `get_exchange_rate` is in `portfolio_tools` and bound to the LLM. ✓
- Prompt instructs: call the tool for USD↔PEN, use compra/venta correctly, cite SUNAT +
  date, never invent a rate, offer the SUNAT page when unavailable. ✓
- Works with NO token (apis.net.pe v1); upgrades to Decolecta when `DECOLECTA_TOKEN` is set. ✓

## Progress / evidence

- COMPLETE on `feat/agent-fx-sunat`.
- Strict TDD: RED = `ImportError: cannot import name 'exchange_rate'` at collection, before
  implementation. GREEN = `test_exchange_rate.py` 11 passed; `test_exchange_rate.py +
  test_tools.py` 37 passed (orchestrator re-run); full non-integration suite 292 passed;
  `ruff check` on the 3 changed .py files clean.
- Tests cover: Decolecta used + bearer header + `date` param when token set; apis.net.pe
  used without token (+ `fecha` param); parametrized fallback (Decolecta 500 / ConnectError
  → apis.net.pe), host order asserted; both-fail → None AND not cached; unparseable body
  falls through; per-date cache (one request per distinct date); `date=None` → today in
  America/Lima; tool found/unavailable shapes; tool registered in `portfolio_tools`.
- Pre-existing unrelated tree changes (.atl/*, package.json files, state.py, test_state.py,
  categories.ts) were NOT included in the commit.

## Next step

Delivery (push/PR) is the user's call. The Decolecta token is optional — the tool works
today via apis.net.pe v1; set `DECOLECTA_TOKEN` (backend secret) to prefer the maintained
provider.
