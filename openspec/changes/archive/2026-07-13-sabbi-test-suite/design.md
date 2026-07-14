# Design: SABBI Comprehensive Test Suite

## Technical Approach

Add real-Postgres integration tests for 3 backend areas (agent tools, REST CRUD, chat history) and bootstrap vitest + RTL for 2 frontend component areas (ProposeProductCard, BulkAcceptBar). Backend tests share a single `conftest.py` fixture layer that connects to a real Postgres via `TEST_DATABASE_URL`, applies `schema.sql`, and uses savepoint-based per-test rollback for speed and isolation. Frontend tests use vitest with jsdom and mock only `useThreadRuntime` at the module boundary.

## Architecture Decisions

### Decision: Test DB isolation via savepoints (transaction rollback)

| Option | Tradeoff | Chosen? |
|--------|----------|---------|
| Savepoint per test (BEGIN + ROLLBACK) | Fast (~0ms cleanup), strong isolation, no leftover state | Yes |
| TRUNCATE all tables between tests | Slower, requires explicit table list maintenance | No |
| CREATE/DROP database per test | Very slow, not practical for a 30+ test suite | No |

**Rationale**: `asyncpg` supports savepoints natively. A session-scoped connection opens a transaction, each test gets a savepoint that rolls back. This is 10-100x faster than TRUNCATE and prevents cross-test leakage. The `products` table has a FK to `users`, so we must insert a test user inside the transaction before product tests.

### Decision: Agent tool test boundary -- patch `get_pool` only

| Option | Tradeoff | Chosen? |
|--------|----------|---------|
| Patch `db.connection.get_pool` to return test pool, call tool `.ainvoke()` directly | Minimal patching, tests real SQL, real repository code | Yes |
| Pass pool through RunnableConfig | Tools don't read pool from config (docstring says so explicitly), would require production code changes | No |
| Instantiate `ProductRepository` directly, skip tool layer | Misses tool wiring (config extraction, composition mapping) | No |

**Rationale**: Tools call `get_pool()` as a module-level singleton. Patching that single function to return the test pool exercises the full code path: tool arg parsing, `_user_id(config)` extraction, `ProductRepository` SQL, and return serialization. `RunnableConfig` is crafted with `{"configurable": {"user_id": test_user_id}}` to match production shape.

### Decision: FastAPI test client -- httpx.AsyncClient + dependency override for auth

| Option | Tradeoff | Chosen? |
|--------|----------|---------|
| `httpx.AsyncClient` with `ASGITransport(app)`, override `get_current_user` dependency, inject test pool in lifespan override | Real async HTTP, tests middleware + routing + serialization, no real JWT needed | Yes |
| `TestClient` (sync, from starlette) | Existing tests use this but it blocks the event loop; adding asyncpg fixtures requires async | No |
| Generate real JWTs for each test | Tests auth module behavior rather than route logic; slower, couples test suite to JWT internals | No |

**Rationale**: The app uses `lifespan` to set `app.state.repo`. Integration tests must override this to inject the test pool. `httpx.AsyncClient(transport=ASGITransport(app=app))` supports async and works with FastAPI's dependency system. Auth is overridden via `app.dependency_overrides[get_current_user]` (same pattern existing tests already use), so no real JWT cookie is needed.

### Decision: Chat history tests -- real checkpointer, mocked LLM node

| Option | Tradeoff | Chosen? |
|--------|----------|---------|
| Compile `graph_builder` with real `AsyncPostgresSaver` checkpointer + mock `agent_node` that returns canned AIMessage | Tests thread persistence and message round-trip through Postgres, no Claude API call | Yes |
| Use `FakeChatGraph` (existing pattern) | Already tested; doesn't verify real checkpointer persistence | No |
| Full graph with real LLM | Requires Claude API key, flaky, expensive | No |

**Rationale**: The value of chat integration tests is verifying that messages persist through `AsyncPostgresSaver` and survive `aget_state` retrieval. Mocking the LLM node to return a fixed `AIMessage` is sufficient. The checkpointer uses `POSTGRES_URI` (same test DB). The existing `FakeChatGraph` tests remain for fast unit coverage of serialization helpers.

### Decision: Frontend test infrastructure -- vitest + jsdom + mock `useThreadRuntime`

| Option | Tradeoff | Chosen? |
|--------|----------|---------|
| vitest + @testing-library/react + jsdom, mock `useThreadRuntime` via `vi.mock` | Lightweight, tests component logic without assistant-ui internals, follows existing React testing patterns | Yes |
| Playwright component tests | Heavy, requires browser, overkill for unit-level card behavior | No |
| Mock all assistant-ui primitives individually | Fragile, tight coupling to library internals | No |

**Rationale**: `ProposeProductCard` and `BulkAcceptBar` call `useThreadRuntime().append()` -- mocking that single hook returns a spy for `append`. The `ProposalBatchContext` is a plain React context we control fully. assistant-ui primitives (`MessagePrimitive.Content`, `ActionBarPrimitive`) are NOT under test -- they are rendering concerns. We test the card's state logic (validation, confirm/reject text composition, batch registration).

## Data Flow

### Backend integration test lifecycle

```
pytest session start
  |
  v
conftest: asyncpg.connect(TEST_DATABASE_URL)
  |-- execute schema.sql (CREATE TABLE IF NOT EXISTS...)
  |-- INSERT test user into users table
  |
  v
per-test function
  |-- BEGIN (savepoint)
  |-- test body (uses pool/connection)
  |-- ROLLBACK (savepoint)
  |
  v
pytest session end
  |-- DROP test tables or close connection
```

### Agent tool integration test data flow

```
test_add_product_integration()
  |
  |-- monkeypatch db.connection.get_pool -> returns test_pool
  |-- craft RunnableConfig({"configurable": {"user_id": test_user_uuid}})
  |-- await add_product.ainvoke({"name": ..., "amount": ...}, config=config)
  |       |
  |       v
  |   add_product() -> get_pool() [patched] -> ProductRepository.create()
  |       |                                        |
  |       v                                        v
  |   returns {"status": "added", ...}       INSERT INTO products (real PG)
  |
  |-- assert product exists in DB via direct SQL query
  |-- ROLLBACK (savepoint restores clean state)
```

### Frontend component test data flow

```
test_propose_card_confirm()
  |
  |-- vi.mock("@assistant-ui/react", () => ({ useThreadRuntime: () => mockRuntime }))
  |-- render(<ProposeProductCard result={...} />) inside <ProposalBatchProvider>
  |-- fill in fields, click "Si, agregar"
  |-- assert mockRuntime.append.calledWith(expected message text)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/pyproject.toml` | Modify | Add `pytest-asyncio`, `httpx` to `[project.optional-dependencies] dev` |
| `apps/backend/tests/conftest.py` | Modify | Add real-Postgres fixtures: `test_pool`, `test_conn`, `test_user`, savepoint auto-rollback |
| `apps/backend/tests/integration/__init__.py` | Create | Package marker for integration test subdir |
| `apps/backend/tests/integration/conftest.py` | Create | Integration-specific fixtures (re-export from parent or add area-specific helpers) |
| `apps/backend/tests/integration/test_tools_pg.py` | Create | Agent tools against real Postgres (add, update, delete, get_summary) |
| `apps/backend/tests/integration/test_routes_pg.py` | Create | FastAPI REST CRUD against real Postgres via httpx.AsyncClient |
| `apps/backend/tests/integration/test_chat_pg.py` | Create | Chat thread state/streaming with real AsyncPostgresSaver, mocked LLM |
| `apps/web/vitest.config.ts` | Create | Vitest config: jsdom env, path aliases matching tsconfig `@/*` |
| `apps/web/vitest.setup.ts` | Create | RTL cleanup, jest-dom matchers |
| `apps/web/package.json` | Modify | Add vitest, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, jsdom to devDeps; add `"test"` script |
| `apps/web/__tests__/propose-product-card.test.tsx` | Create | ProposeProductCard: render, validation, confirm text, reject text, batch registration |
| `apps/web/__tests__/bulk-accept-bar.test.tsx` | Create | BulkAcceptBar: batch collection, button gating on incomplete products, "Agregar todos" message |

## Interfaces / Contracts

### Backend: conftest.py test fixtures (key signatures)

```python
@pytest.fixture(scope="session")
async def test_pool() -> AsyncGenerator[asyncpg.Pool, None]:
    """Connect to TEST_DATABASE_URL, apply schema.sql, yield pool, close."""

@pytest.fixture(scope="session")
async def test_user_id(test_pool) -> str:
    """Insert a deterministic test user, return its UUID."""

@pytest.fixture(autouse=True)
async def _rollback(test_pool):
    """Wrap each test in a savepoint, rollback after."""

@pytest.fixture
def patch_get_pool(test_pool, monkeypatch):
    """Monkeypatch db.connection.get_pool to return test_pool."""

@pytest.fixture
def tool_config(test_user_id) -> RunnableConfig:
    """Return {"configurable": {"user_id": test_user_id}}."""
```

### Backend: FastAPI test client fixture

```python
@pytest.fixture
async def api_client(test_pool, test_user_id) -> AsyncGenerator[httpx.AsyncClient, None]:
    """Create httpx.AsyncClient against the real app with test pool injected."""
```

### Frontend: vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Integration (backend) | Agent tools CRUD against real Postgres | Patch `get_pool`, call `.ainvoke()` with crafted RunnableConfig, verify DB state via direct queries |
| Integration (backend) | FastAPI REST endpoints against real Postgres | `httpx.AsyncClient` + `ASGITransport`, dependency override for auth, assert response shapes and DB state |
| Integration (backend) | Chat thread state persistence | Real `AsyncPostgresSaver` checkpointer, mock LLM node (returns canned AIMessage), verify `aget_state` returns persisted messages |
| Unit (frontend) | ProposeProductCard rendering, validation, confirm/reject | vitest + RTL, mock `useThreadRuntime`, verify `append` call args |
| Unit (frontend) | BulkAcceptBar batch logic, gating, message composition | vitest + RTL, render multiple cards in `ProposalBatchProvider`, verify bulk confirm text |

## Migration / Rollout

No migration required. Test files and dev dependencies only -- no production code changes. `TEST_DATABASE_URL` defaults to `postgresql://postgres:postgres@localhost:5432/sabbi_test` when not set. CI will need a `services: postgres` block (out of scope per proposal, but `TEST_DATABASE_URL` env var makes it straightforward).

## Open Questions

- [ ] Should `test_pool` use a single connection wrapped in a transaction (true savepoint isolation) or a real pool with TRUNCATE? Single-connection savepoint is faster but prevents testing pool-level concurrency. **Recommendation**: Use single-connection-as-pool wrapper for speed; pool concurrency is not under test here.
- [ ] Should `ProposeProductCard` and `BulkAcceptBar` be extracted from `thread.tsx` into separate files before testing? They are currently unexported (file-private). **Recommendation**: Export them from `thread.tsx` for testability without moving files; extraction is a future refactor.
