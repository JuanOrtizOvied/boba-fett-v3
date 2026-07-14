# Tasks: SABBI Comprehensive Test Suite

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~900-1100 (7 new/modified files backend, 5 frontend) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Backend fixture infra (`conftest.py`, `pyproject.toml`, `tests/integration/`) | PR 1 | Base = main. ~150 lines. Blocks PR 2-4. |
| 2 | Agent tool CRUD tests (`test_tools_pg.py`) | PR 2 | Base = main. ~200 lines. Depends on PR 1 merged. |
| 3 | REST API CRUD tests (`test_routes_pg.py`) | PR 3 | Base = main. ~200 lines. Depends on PR 1 merged. |
| 4 | Chat persistence tests (`test_chat_pg.py`) | PR 4 | Base = main. ~150 lines. Depends on PR 1 merged. |
| 5 | Frontend test infra + component exports | PR 5 | Base = main. ~60 lines. Independent of PR 1-4. Blocks PR 6-7. |
| 6 | ProposeProductCard tests | PR 6 | Base = main. ~200 lines. Depends on PR 5 merged. |
| 7 | BulkAcceptBar tests | PR 7 | Base = main. ~150 lines. Depends on PR 5 merged. |

## Phase 1: Backend Test Infrastructure (PR 1)

- [x] 1.1 Add `pytest-asyncio>=0.24`, `httpx>=0.27` to `apps/backend/pyproject.toml` `[project.optional-dependencies] dev`.
- [x] 1.2 Add `test_pool` (session, `TEST_DATABASE_URL`, applies `db/schema.sql`), `test_user_id`, `_rollback` (autouse savepoint), `patch_get_pool`, `tool_config` fixtures to `apps/backend/tests/conftest.py`.
- [x] 1.3 Create `apps/backend/tests/integration/__init__.py` package marker.
- [x] 1.4 Create `apps/backend/tests/integration/conftest.py` with `api_client` fixture: `httpx.AsyncClient` + `ASGITransport(app)`, `get_current_user` dependency override, test pool injected into `app.state.repo`.

## Phase 2: Backend Integration Tests

- [x] 2.1 Create `apps/backend/tests/integration/test_tools_pg.py`: `add_product` persists valid / rejects `amount<=0`; `update_product` updates existing / errors on nonexistent id; `delete_product` removes existing / errors on nonexistent id; `get_portfolio_summary` empty and populated (2 categories). Depends on: 1.2, 1.4. Spec: "Agent Tool CRUD Against Real Postgres".
- [x] 2.2 Create `apps/backend/tests/integration/test_routes_pg.py`: POST create valid (201) / invalid amount (422, no insert); unauthenticated (401); PATCH by non-owner incl. admin (403, unchanged); DELETE nonexistent (404); GET list/summary scoped to caller only. Depends on: 1.4. Spec: "REST API CRUD With Ownership and Auth Enforcement".
- [x] 2.3 Create `apps/backend/tests/integration/test_chat_pg.py`: new thread returns `messages: []`; message round-trips via mocked LLM node + real `AsyncPostgresSaver`; 3-pair thread returns 6 messages in order; empty `message` returns 422. Depends on: 1.2, 1.4. Spec: "Chat Thread Persistence".

## Phase 3: Frontend Test Infrastructure (PR 5)

- [x] 3.1 Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom` to `apps/web/package.json` devDependencies; add `"test": "vitest run"` script.
- [x] 3.2 Create `apps/web/vitest.config.ts`: `environment: "jsdom"`, `setupFiles: ["./vitest.setup.ts"]`, `@/*` alias matching `tsconfig.json`.
- [x] 3.3 Create `apps/web/vitest.setup.ts`: RTL `cleanup` after each test + `@testing-library/jest-dom` matchers.
- [x] 3.4 Export `ProposeProductCard` (line 624) and `BulkAcceptBar` (line 887) from `apps/web/components/assistant-ui/thread.tsx` — currently file-private.

## Phase 4: Frontend Component Tests

- [x] 4.1 Create `apps/web/__tests__/propose-product-card.test.tsx`: renders full product / null for non-`proposed` status; missing-field warning + disabled confirm; editing amount clears warning; confirm sends exact composed text and flips to confirmed; confirm no-op when invalid; reject always sends rejection text; entry registers on mount / unregisters on unmount in `ProposalBatchProvider`. Depends on: 3.1-3.4. Spec: "ProposeProductCard Rendering / Field Editing / Confirm and Reject Actions / ProposalBatchProvider Registration".
- [x] 4.2 Create `apps/web/__tests__/bulk-accept-bar.test.tsx`: hidden with 1 pending entry; visible with 2+ pending (partial invalid) showing count + disabled bulk button; hidden once all responded; "Agregar todos" sends one combined message and marks all `responded: "yes"`. Depends on: 3.1-3.4. Spec: "BulkAcceptBar Visibility Gating / Combined Confirmation Message".
