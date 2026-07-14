# Proposal: SABBI Comprehensive Test Suite

## Intent

The backend has ~20 test files but ALL mock asyncpg — zero real Postgres integration tests. The user has been burned by mock/prod divergence. Frontend has zero test infrastructure. This change adds real-DB integration tests for the 3 backend areas and bootstraps vitest + RTL for the 2 frontend component areas.

## Scope

### In Scope
- **Area 1**: Real Postgres integration tests for chat thread creation, state persistence, and history retrieval (`chat_routes.py` endpoints)
- **Area 2**: Real Postgres integration tests for agent tools (`add_product`, `update_product`, `delete_product`, `get_portfolio_summary`) called directly with mocked LangGraph `RunnableConfig` — no LLM invocation
- **Area 3**: Real Postgres integration tests for FastAPI REST CRUD endpoints (`routes.py`) — full request/response cycle against real DB
- **Area 4**: Vitest + RTL tests for `ProposeProductCard`: rendering, field validation, confirm/reject actions, `ProposalBatchProvider` context registration
- **Area 5**: Vitest + RTL tests for `BulkAcceptBar`: batch collection, "Agregar todos" message composition, incomplete-product gating
- Shared `conftest.py` with real asyncpg pool fixture, test DB setup/teardown, and schema migration
- Frontend test infrastructure: vitest config, jsdom environment, RTL setup

### Out of Scope
- E2E / Playwright tests
- LLM integration tests (Claude API calls)
- Full LangGraph graph execution tests
- Replacing existing mock-based unit tests (they remain for fast CI)
- CI pipeline changes (test commands already exist in `package.json`)

## Capabilities

### New Capabilities
- `backend-integration-testing`: Real Postgres test fixtures, integration tests for chat history, agent tools, and REST CRUD
- `frontend-component-testing`: Vitest + RTL infrastructure and component tests for proposal cards and batch accept

### Modified Capabilities
None

## Approach

**Backend**: Add `pytest-asyncio` + `asyncpg` test fixtures that connect to a real Postgres instance (configurable via `TEST_DATABASE_URL`). Schema applied via `db/schema.sql` in session-scoped fixture, per-test transaction rollback for isolation. Agent tools tested by calling `ainvoke` directly with crafted `RunnableConfig` containing `user_id`, patching only `get_pool` to return the test pool.

**Frontend**: Add `vitest` + `@testing-library/react` + `jsdom`. Extract `ProposeProductCard`, `ProposalBatchProvider`, and `BulkAcceptBar` tests using a minimal mock of `useThreadRuntime` (returns `append` spy). No assistant-ui internals mocked beyond the runtime.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/backend/tests/` | New | Integration test files + enhanced conftest |
| `apps/backend/pyproject.toml` | Modified | Add pytest-asyncio, httpx dev deps |
| `apps/web/__tests__/` | New | Component test files |
| `apps/web/package.json` | Modified | Add vitest, @testing-library/react, jsdom |
| `apps/web/vitest.config.ts` | New | Vitest configuration |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| CI needs running Postgres for integration tests | High | Use `TEST_DATABASE_URL` env var; CI can use `services: postgres` in GitHub Actions |
| `ProposeProductCard` tightly coupled to assistant-ui primitives | Medium | Mock `useThreadRuntime` and `useContext(ProposalBatchContext)` at module level |
| Test DB state leakage between tests | Low | Per-test transaction rollback via savepoints |

## Rollback Plan

Remove new test files, revert `pyproject.toml` and `package.json` dependency additions. Existing mock-based tests are untouched and remain functional.

## Dependencies

- Running PostgreSQL instance (local or Docker) for backend integration tests
- `pytest-asyncio` and `httpx` Python packages
- `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` npm packages

## Success Criteria

- [ ] All 5 requested test areas have passing test suites
- [ ] Backend integration tests run against real Postgres (not mocks)
- [ ] Agent tool tests call functions directly without LLM invocation
- [ ] Frontend component tests cover confirm/reject/batch flows
- [ ] `pytest -q` and `vitest run` both pass from clean state
- [ ] Existing mock-based tests remain green

## Proposal question round

These questions would sharpen the proposal before spec/design. Assumptions are listed after each — correct or answer as needed.

1. **Test database lifecycle**: Should integration tests create/drop a dedicated test database automatically, or assume one already exists at `TEST_DATABASE_URL`?
   *Assumption*: Tests assume the database exists; `conftest.py` only applies `schema.sql` and rolls back per-test via savepoints.

2. **Chat history scope**: The chat graph uses `langgraph-checkpoint-postgres` for thread state. Should tests verify the LangGraph checkpointer's Postgres persistence directly, or only test the FastAPI chat endpoints (`/chat/threads/:id/state`, `/chat/threads/:id/messages/stream`) which wrap the graph?
   *Assumption*: Test the FastAPI endpoints with a real compiled graph (using a real Postgres checkpointer) but mock the LLM node to return canned responses — verifying that messages round-trip through Postgres.

3. **Frontend mock boundary**: `ProposeProductCard` calls `runtime.append()` on confirm/reject. Should tests verify the message TEXT content sent to the runtime, or just that `append` was called?
   *Assumption*: Verify the exact message text (e.g., "Si, agregar al portafolio con: nombre: X, monto: Y...") since it drives downstream agent behavior.

4. **Coverage target**: Is there a minimum coverage percentage goal, or is the goal simply "all 5 areas have meaningful tests"?
   *Assumption*: No coverage percentage target — the goal is meaningful scenario coverage for the 5 areas.
