# Verify Report: sabbi-portfolio-agent

**Date**: 2026-07-06
**Mode**: hybrid (OpenSpec files + Engram)
**Verdict**: PASS WITH WARNINGS

## Runtime Evidence

| Check | Command | Result |
|---|---|---|
| Backend tests | `apps/backend/.venv/bin/pytest -q` | 60 passed, 0 failed |
| Backend lint (CI-equivalent) | `apps/backend/.venv/bin/ruff check src/` | **FAILED — exit 1, 2 errors** |
| Frontend type-check | `npx tsc --noEmit -p apps/web/tsconfig.json` | 0 errors, exit 0 |
| Frontend lint | `yarn workspace web lint` (`eslint .`) | 0 errors |
| Secrets scan | `rg` for API key patterns / committed `.env` | none found |
| SQL injection check | `db/repository.py` uses `$1..$n` parameterized asyncpg queries throughout | no string-interpolated SQL |

## Task Completeness (tasks.md)

30/31 tasks checked. T-107 (manual backend testing, live Postgres + Anthropic) correctly left unchecked — accepted deferral, infra-dependent, cannot be verified in this environment. All other 30 tasks correspond to real, present implementation artifacts (verified by direct file reads, not just checkbox trust).

## Design Coherence (design.md)

Architecture matches design.md with the pre-approved deviations only:
- `extract_products_node` dropped; `process_document_node` injects an extraction prompt and `agent_node` performs extraction via tool calls — matches accepted deviation.
- Postgres pool via `get_pool()` singleton instead of `RunnableConfig` — matches accepted deviation (asyncpg.Pool can't cross the LangGraph JSON boundary).
- Graph nodes/edges (`router` → `process_document`|`agent` → `tools`|END → loop) match design.md's graph diagram exactly.
- REST API (`routes.py`) matches design.md's endpoint list exactly (list/create/update/delete/summary/export).
- Excel export (`excel.py`) matches design.md's approach (server-side openpyxl, "Portafolio Final" summary sheet + per-category sheets), with an improved category order/format vs. the design.md snippet — not a regression.
- No unauthorized/unaccepted design deviations found.

## Spec Compliance Matrix (summary)

50 total Gherkin scenarios across 4 spec files. 2 are explicitly marked `[DEFERRED v1.1]` in the spec files themselves (link processing, "Enviar a SABBI" submission) and are correctly implemented as deferred (disabled button with tooltip; links treated as plain text). Of the remaining 48:

- **Backend scenarios with real automated test coverage** (60 passing pytest tests): agent state schema, category taxonomy, graph node/edge structure, `should_continue`/`has_file_attachment` routing, all 4 tool schemas, `ProductRepository` CRUD/summary (mocked `asyncpg.Pool`), Excel workbook generation/content.
- **Backend scenarios verified by source inspection only** (require live Anthropic API + Postgres, deferred to T-107 per accepted scope): PDF/image extraction via Claude vision, system prompt content, SSE streaming, error-message copy on corrupt files, cross-thread/reload persistence, multi-investor concurrency isolation. Source inspection confirms these are implemented as designed; runtime confirmation is explicitly out of scope for this batch.
- **Frontend scenarios verified by source inspection + `tsc`/`eslint`, not automated component/E2E tests** (T-602/T-603 accepted deferral — no test framework configured for `apps/web`): all dashboard, product-card, and modal scenarios. Source inspection found every described UI element, validation rule, and interaction implemented in the corresponding component.

Estimated spec coverage: **48/50 scenarios (96%) implemented in source**; automated runtime-test coverage is limited to the backend logic layer, consistent with the explicitly accepted T-107/T-602/T-603 deferrals.

## Findings

### CRITICAL

1. **Backend CI lint step currently fails.** `ci.yml`'s backend job runs `ruff check src/` on every PR/push to `main`. Running that exact command locally exits 1 with 2 errors:
   - `src/db/__init__.py:1` — `I001` unsorted import block (`from db.connection import get_pool, close_pool, get_repository` should be `close_pool, get_pool, get_repository`).
   - `src/db/repository.py:31` — `E501` line too long (101 > 100 chars) in the `INSERT INTO products (...)` SQL string.
   This means the CI pipeline declared complete under T-604 is currently broken and any PR touching the backend will fail lint. This blocks archive readiness per the "test command exits non-zero → CRITICAL" gate.

### WARNING

1. **`category` has no enum/Literal validation.** `db/models.py` (`Product`, `ProductCreate`, `ProductUpdate`) and `agent/tools.py` type `category` as plain `str` with only a docstring hint ("One of: directas, privados, club, publicos, otros, cash"). The spec (`langgraph-agent.spec.md` → "Tool — add_product") describes `category` as `CategoryEnum`. Nothing rejects an invalid category value at the Pydantic or FastAPI boundary. Because the frontend (`PortfolioPanel.tsx`) only groups/renders products whose `category` matches one of the 6 known `CATEGORY_ORDER` keys, a product saved with an unrecognized category would persist in Postgres but silently vanish from every view (no error surfaced to the user) — a real, if narrow, data-integrity gap.

2. **`get_portfolio_summary` / `ProductRepository.get_summary` omit `composition_breakdown`.** The spec scenario "Tool — get_portfolio_summary" lists `composition_breakdown` (distribución por asset class) as an expected field in the summary payload. The shipped implementation returns `total_amount`, `product_count`, `categories_used`, `distribution`, `largest_position` but never computes a composition breakdown. Not currently consumed by any UI feature, so it's non-blocking, but it is a documented spec field with no corresponding implementation.

### SUGGESTION

1. Stale doc comments: `apps/web/app/page.tsx` and `apps/web/components/portfolio/PortfolioSummary.tsx` both describe `usePortfolio`'s background poll as "5s poll" in their docstrings, but `usePortfolio.ts` actually uses `REFETCH_POLL_MS = 15000` (15s). Harmless (comment-only), but worth correcting to avoid confusing future readers.
2. Consider tightening `category: str` to a `Literal["directas", "privados", "club", "publicos", "otros", "cash"]` (or a shared enum) across `db/models.py` and `agent/tools.py` to close the WARNING above at the type-system level rather than relying solely on the system prompt to keep Claude within the 6 valid categories.
3. `ruff --fix` resolves the `I001` import-order finding automatically; the `E501` line needs a manual wrap/reflow of the SQL string or a targeted `# noqa: E501`.

## Known Accepted Deviations (confirmed, not re-flagged)

- T-107 manual backend testing — deferred, needs live Postgres + Anthropic key.
- T-602/T-603 frontend/E2E tests — deferred, no test framework configured for `apps/web`.
- `extract_products_node` dropped from the original design — confirmed in `agent/nodes.py` and `agent/graph.py`.
- Pool via `get_pool()` singleton instead of `RunnableConfig` — confirmed in `agent/tools.py`, `db/connection.py`.
- Link processing `[DEFERRED v1.1]` — confirmed in spec file and `thread.tsx` (Link is a plain focus-composer button, not a file adapter).
- "Enviar a SABBI" disabled with tooltip — confirmed in `Topbar.tsx` (`disabled`, tooltip text "Próximamente").

## Recommendation

**fix** — one CRITICAL item (CI lint failure) should be resolved before archive: it is a two-line, mechanical fix (reorder imports in `db/__init__.py`, wrap/shorten the SQL literal in `db/repository.py` or raise `ruff`'s line-length / add a targeted `noqa`). The WARNING items are real but narrow and can reasonably be archived with a follow-up note, if the user prefers not to block on them.
