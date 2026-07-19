# Tasks: Portfolio Versioning

## Review Workload Forecast

- Estimated changed lines: ~1450-1750 (refined from the proposal's 900-1200 after
  accounting for: transactional rewrite of three existing repository methods,
  a full second repository file with five methods, five new REST routes plus
  two admin read-only routes, one new agent tool, a new frontend hook, and
  six new frontend components — each with matching tests per the project's
  existing pytest/vitest coverage conventions).
- Chained PRs recommended: Yes
- 400-line budget risk: High
- Decision needed before apply: Yes — confirm the 7-PR stacked-to-main split
  below (finer-grained than the proposal's 3-PR sketch) before `sdd-apply`
  starts, since PR4/PR5 in the proposal's sketch would each exceed 400 lines
  once tests are included.

## PR Boundary Recommendation

The proposal sketched 3 PRs (schema+audit+snapshot CRUD / agent+REST / frontend).
Splitting each of those further keeps every PR reviewable in isolation and
independently revertible:

1. **PR1 — Schema + Audit Log Foundation**: new tables, transactional
   `ProductRepository` rewrite, test-fixture support for transactions.
   Nothing here is user-visible yet — it's the trust boundary everything else
   builds on.
2. **PR2 — Snapshot Repository**: `VersioningRepository.create_snapshot`,
   `list_snapshots`, `get_snapshot`. No routes yet — repo-level only, testable
   in isolation.
3. **PR3 — Comparison + Change Log Repository**: `compare_snapshots`,
   `list_changes` added to `VersioningRepository`. Depends on PR2's file
   existing.
4. **PR4 — Agent Tool Integration**: `source="agent"` wiring on the three
   existing tools + new `create_snapshot` tool. Small, isolated, high-value
   for manual QA via chat.
5. **PR5 — REST API Endpoints**: five new FastAPI routes + two admin
   read-only routes + Pydantic request models. Depends on PR2/PR3's repo
   methods and PR1's `source` plumbing.
6. **PR6 — Frontend Data Layer + Snapshot Creation UI**: `usePortfolioVersioning`
   hook (snapshot slice only) + `SnapshotButton` + `SnapshotModal` +
   `VersioningBar`. Ships the first user-visible capability (SNAP-007).
7. **PR7 — Frontend History Drawer + Comparison View**: `VersioningDrawer`,
   `SnapshotList`, `ChangeLog`, `ComparisonView`. Depends on PR6's hook
   (extended with comparison/changes slices) and PR5's endpoints.

Each PR is independently deployable per the design's rolling-deploy note
(design.md → "Migration Strategy" #3): new tables/routes 404 gracefully if
the frontend ships ahead of the backend, and the reverse is a no-op until the
frontend calls the new routes.

### Design deviation flagged for `sdd-apply` (must resolve, not skip)

`design.md`'s `create_snapshot` example code raises `ValueError("Cannot
create snapshot of an empty portfolio")` when `rows` is empty, and the
"Frontend Error Handling" section repeats this as the empty-portfolio
behavior. This **directly contradicts SNAP-009** (Priority: Should), which
requires `POST /portfolio/me/snapshots` on an empty portfolio to return
`201` with `product_count = 0`, `total_amount = 0`, and zero
`snapshot_products` rows — not an error. The spec is the acceptance
criteria; PR2 (T-008) implements the SNAP-009 behavior and PR6 must NOT
disable the snapshot button on `productCount === 0` as design.md's frontend
section suggests. Flagging this explicitly so `sdd-apply` doesn't silently
follow the stale design snippet.

### Test-infrastructure gap flagged for `sdd-apply`

`tests/conftest.py`'s `FakePool` (used by every existing repository/tool
test) only forwards `fetch`/`fetchrow`/`fetchval`/`execute` — it has **no
`acquire()` method**. The design's transaction pattern (ADR-1, ADR-5) is
built entirely on `async with self.pool.acquire() as conn: async with
conn.transaction():`. Without extending `FakePool`, none of PR1's or PR2's
new transactional code is testable through the existing fixture. T-001
below adds this before any transactional repository code is written.

---

## Tasks

### PR 1: Schema + Audit Log Foundation

- [x] **T-001**: Extend `FakePool` with an `acquire()` async context manager
  - **Files**: `apps/backend/tests/conftest.py`
  - **Specs**: (test-infrastructure prerequisite for AL-001..AL-005)
  - **Description**: Add an `acquire()` method to `FakePool` that returns an
    async context manager yielding the wrapped `_session_conn` (mirroring
    `asyncpg.Pool.acquire()`'s shape: `async with pool.acquire() as conn:`).
    Since `_session_conn` is already wrapped in a per-test SAVEPOINT by the
    autouse `_rollback` fixture, no double-locking logic is needed — the
    returned "connection" is just the same connection object.
    Note: `conn.transaction(isolation="repeatable_read")` inside an
    already-open outer transaction/savepoint raises in real Postgres
    (`current transaction is already committed/started` semantics don't
    apply, but nested isolation-level changes do); confirm behavior with a
    smoke test in T-004/T-008 and fall back to a plain nested transaction
    (no explicit isolation override) in the `FakePool` path if needed,
    documenting the divergence from production isolation level in a comment.
  - **Acceptance**: A throwaway test doing
    `async with test_pool.acquire() as conn: async with conn.transaction(): await conn.execute(...)`
    passes against a real `TEST_DATABASE_URL`.

- [x] **T-002**: Add versioning tables to `schema.sql`
  - **Files**: `apps/backend/src/db/schema.sql`
  - **Specs**: AL-001, AL-002, AL-003 (schema prerequisites), SNAP-001, SNAP-002
  - **Description**: Append the `portfolio_snapshots`, `snapshot_products`,
    and `portfolio_changes` tables plus their indexes exactly as specified in
    design.md → "Database Schema" (all `CREATE TABLE IF NOT EXISTS` /
    `CREATE INDEX IF NOT EXISTS` — no `ALTER TABLE` on existing tables, per
    the project's zero-downtime migration convention already used for
    `products`/`product_catalog`).
  - **Acceptance**: `psql $TEST_DATABASE_URL -f schema.sql` (or the session
    fixture's `conn.execute(_SCHEMA_PATH.read_text())`) applies cleanly on a
    fresh DB and idempotently on an already-migrated one.

- [x] **T-003**: Make `ProductRepository.create`/`update`/`delete` transactional with audit logging
  - **Files**: `apps/backend/src/db/repository.py`
  - **Specs**: AL-001, AL-002, AL-003, AL-004, AL-005
  - **Description**: Per design.md ADR-1 and ADR-4: add optional
    `source: str = "api"`, `metadata: dict | None = None`,
    `conn: asyncpg.Connection | None = None` keyword params to `create`,
    `update`, `delete`. Split each into a public method (acquires
    `pool.acquire()` + `conn.transaction()` when `conn` is not passed in) and
    a `_*_impl(conn, ...)` that does the actual work + calls the new
    `_log_change(conn, ...)` helper inside the same transaction. `update`
    and `delete` must `SELECT ... FOR UPDATE` the row first to capture
    `before_state` inside the transaction (design.md → "For `update`" /
    "For `delete`"). A not-found update/delete must return `None`/`False`
    without inserting a change-log row (AL-002 "No-op update" / AL-003
    "Deleting a non-existent product" scenarios) — check existence before
    calling `_log_change`, not after.
  - **Acceptance**: Existing callers (`agent/tools.py`, `api/routes.py`)
    that call `repo.create(user_id, data)` / `repo.update(id, data)` /
    `repo.delete(id)` positionally continue to work unmodified (new params
    are keyword-only with defaults) — run the existing `test_tools.py` and
    `test_routes_guarded.py` suites unchanged and confirm they still pass.

- [x] **T-004**: Tests for transactional audit logging
  - **Files**: `apps/backend/tests/integration/test_repository_audit_pg.py` (new)
  - **Specs**: AL-001, AL-002, AL-003, AL-004, AL-005
  - **Description**: Using `test_pool`/`test_user_id` fixtures (extended per
    T-001), cover: create logs `operation='create'`, `before_state=NULL`;
    update logs full before/after state with partial-field updates only
    changing the touched field in `after_state` while other fields persist
    from the prior row; delete logs `before_state` populated, `after_state
    =NULL`; no-op update/delete on a missing id logs nothing; `source`
    defaults to `'api'` and is overridden when passed; `metadata` round-trips
    as JSONB. For AL-004 atomicity, force a failure inside `_log_change`
    (e.g. monkeypatch it to raise after the product mutation executes) and
    assert the product mutation is rolled back (row absent/unchanged after
    the call raises).
  - **Acceptance**: `pytest apps/backend/tests/integration/test_repository_audit_pg.py -q`
    passes against `TEST_DATABASE_URL`.

### PR 2: Snapshot Repository

- [x] **T-005**: Create `VersioningRepository` — `create_snapshot`
  - **Files**: `apps/backend/src/db/versioning.py` (new)
  - **Specs**: SNAP-001, SNAP-002, SNAP-009, SNAP-011
  - **Description**: Implement `create_snapshot(user_id, name, description="")`
    per design.md's ADR-2/ADR-5 shape, with the SNAP-009 deviation noted
    above: an empty product set MUST succeed and insert a snapshot header
    with `product_count=0`, `total_amount=0` and zero `snapshot_products`
    rows — do not raise. Use `conn.transaction(isolation="repeatable_read")`
    + `SELECT ... FOR SHARE` on `products WHERE user_id = $1` for SNAP-011
    isolation. Materialize every product's full field set into
    `snapshot_products.product_data` (all fields listed in design.md's
    example, not just id/name/amount — SNAP-002 scenario requires
    `composition`, `asset_class`, `commission`, etc. to survive).
  - **Acceptance**: Creating a snapshot on a portfolio with enrichment
    fields set round-trips every field through `product_data`; creating a
    snapshot on an empty portfolio returns `201`-shaped data with
    `product_count=0` and no `snapshot_products` rows.

- [x] **T-006**: `VersioningRepository` — `list_snapshots`, `get_snapshot`
  - **Files**: `apps/backend/src/db/versioning.py`
  - **Specs**: SNAP-003, SNAP-004, SNAP-005, SNAP-010
  - **Description**: `list_snapshots(user_id, limit=50, offset=0)` returns
    summary rows (no `snapshot_products` payload) ordered by `created_at
    DESC`. `get_snapshot(snapshot_id, user_id)` returns the full snapshot
    including materialized products, scoped to the given `user_id` — return
    `None` (not raise) when the snapshot doesn't exist OR belongs to a
    different user, so the caller (PR5's route) can uniformly 404 without
    disclosing existence to a non-owner (SNAP-010 "Non-owner denied" wants
    `403` or `404` — `404` via `None` keeps this simple and non-disclosing).
    SNAP-005 immutability is satisfied by omission — do not add any
    update/delete method to this class.
  - **Acceptance**: `list_snapshots` for a user with 3 snapshots created in
    order A, B, C returns `[C, B, A]`; `get_snapshot` for another user's
    snapshot id returns `None`.

- [x] **T-007**: `create_snapshot` isolation test under concurrent mutation
  - **Files**: `apps/backend/tests/integration/test_versioning_repository_pg.py` (new)
  - **Specs**: SNAP-011
  - **Description**: Using two concurrently-acquired connections against the
    same `test_pool`'s underlying database (or two interleaved coroutines
    sharing the savepoint-safe pattern established in T-001), drive a
    snapshot creation concurrently with an `add_product`/`delete_product`
    call for the same user and assert the resulting snapshot's
    `product_count` always matches its materialized `snapshot_products` row
    count (never a partial/inconsistent state) — regardless of which
    operation's transaction commits first.
  - **Acceptance**: Test passes deterministically across repeated runs (not
    flaky) — if true concurrency is hard to simulate against the
    savepoint-isolated fixture, document the simplification taken (e.g.
    testing the two orderings sequentially instead of true concurrency) in
    a test docstring rather than silently weakening the assertion.

- [x] **T-008**: Tests for `create_snapshot`/`list_snapshots`/`get_snapshot`
  - **Files**: `apps/backend/tests/integration/test_versioning_repository_pg.py`
  - **Specs**: SNAP-001, SNAP-002, SNAP-003, SNAP-004, SNAP-005, SNAP-009, SNAP-010
  - **Description**: Cover: full-field materialization; later live-product
    edits/deletes don't affect an already-created snapshot (SNAP-002
    scenarios); empty-portfolio snapshot succeeds (SNAP-009); list ordering
    and empty-list case (SNAP-003); detail 404/`None` for missing id
    (SNAP-004); non-owner `get_snapshot` returns `None` (SNAP-010); repeated
    reads of the same snapshot are byte-identical across time and
    intervening unrelated mutations (SNAP-005).
  - **Acceptance**: `pytest apps/backend/tests/integration/test_versioning_repository_pg.py -q -k "not concurrent"` passes.

### PR 3: Comparison + Change Log Repository

- [x] **T-009**: `VersioningRepository` — `compare_snapshots`
  - **Files**: `apps/backend/src/db/versioning.py`
  - **Specs**: CMP-001, CMP-002, CMP-003, CMP-006, CMP-007
  - **Description**: Implement `compare_snapshots(snapshot_a_id, snapshot_b_id, user_id)`
    per design.md's ADR-3 example: verify both snapshots belong to
    `user_id` (raise a distinguishable exception — e.g. a dedicated
    `SnapshotAccessError`/`SnapshotNotFoundError` — so PR5's route can map
    cross-user access to `403`/`404` and a missing id to `404` per CMP-001's
    two distinct scenarios, rather than collapsing both into one generic
    `ValueError`). Diff by `product_id` (CMP-002: never by name — same-name
    delete+recreate must show as one `removed` + one `added`, not
    `modified`). For `modified` entries, include a per-field delta covering
    at minimum `amount`, `category`, `subcategory`, `provider`,
    `composition` (CMP-003), skipping `id`/`user_id` per design.md's note.
    `a` is always the baseline for `before`/`after` labeling regardless of
    `created_at` order (CMP-007). Self-comparison (`a == b`) returns empty
    `added`/`removed`/`modified` (CMP-006) — this falls out naturally from
    the set-difference algorithm, just confirm it with a test rather than
    special-casing it.
  - **Acceptance**: Comparing a snapshot to itself returns all-empty diff
    lists; comparing `a=newer, b=older` produces `before` values from the
    newer snapshot; a delete-then-recreate-with-same-name pair across two
    snapshots produces one `removed` + one `added`, never a `modified`.

- [x] **T-010**: `VersioningRepository` — `list_changes`
  - **Files**: `apps/backend/src/db/versioning.py`
  - **Specs**: AL-006, AL-007
  - **Description**: `list_changes(user_id, limit=50, offset=0, product_id=None)`
    returns `portfolio_changes` rows for `user_id` only, ordered by
    `created_at DESC`, paginated via `limit`/`offset`, optionally filtered
    by `product_id`. Return pagination metadata (`total`, `has_more`) per
    AL-006's "Default page size" scenario. Ownership is enforced entirely by
    the `WHERE user_id = $1` clause — there is no cross-user path in this
    method; the admin-scoped read path (AL-007 "Admin views a client's
    change history") is a separate route added in PR5 that also calls this
    same method with the target client's `user_id`, never a different
    method — reuse, don't fork the query.
  - **Acceptance**: A user with 150 changes gets 50 back by default with
    correct pagination metadata; `?product_id=X`-equivalent filtering
    returns only that product's entries; a brand-new user gets an empty
    list with no error.

- [x] **T-011**: Tests for `compare_snapshots` and `list_changes`
  - **Files**: `apps/backend/tests/integration/test_versioning_repository_pg.py`
  - **Specs**: CMP-001, CMP-002, CMP-003, CMP-006, CMP-007, AL-006, AL-007
  - **Description**: Cover every CMP scenario from `comparison.spec.md`
    (added/removed/modified classification, same-name re-creation,
    unchanged-product exclusion, amount-only delta, composition delta,
    category delta, multi-field delta, cross-user denial, missing-id 404,
    self-compare) and every AL-006/AL-007 scenario (default page size,
    explicit pagination, empty log, operation-type filter, ownership
    scoping, unauthenticated is out of scope here — that's route-level in
    PR5).
  - **Acceptance**: `pytest apps/backend/tests/integration/test_versioning_repository_pg.py -q` passes (full file, both T-008 and T-011 cases).

### PR 4: Agent Tool Integration

- [x] **T-012**: Wire `source="agent"` through existing portfolio tools
  - **Files**: `apps/backend/src/agent/tools.py`
  - **Specs**: AL-005
  - **Description**: Update `add_product`, `update_product`, `delete_product`
    to pass `source="agent"` and `metadata={"tool": "<tool_name>"}` to their
    respective `repo.create`/`.update`/`.delete` calls, per design.md →
    "Agent Tools (agent/tools.py)". No change to any tool's external
    signature or return shape.
  - **Acceptance**: `test_tools.py`'s existing schema tests still pass
    unmodified (signatures unchanged); a new assertion confirms the
    repository call site now includes `source="agent"`.

- [x] **T-013**: Add `create_snapshot` agent tool
  - **Files**: `apps/backend/src/agent/tools.py`
  - **Specs**: SNAP-006
  - **Description**: New `@tool async def create_snapshot(name, description="", *, config)`
    per design.md's example — resolves `user_id` via `_user_id(config)` (same
    pattern as other tools), calls `VersioningRepository.create_snapshot`,
    returns `{"status": "created", "snapshot": {...}}` on success or
    `{"status": "error", "message": ...}` on failure. Add it to the
    `portfolio_tools` list. The tool's docstring must instruct the LLM to
    call it only on explicit user request or confirmation — SNAP-006's
    "Agent suggests a snapshot without auto-creating it" scenario is a
    prompt-level behavior, not enforceable in code, so the docstring is the
    control point (mirror `propose_product`'s docstring pattern for
    "confirm before acting").
  - **Acceptance**: `test_portfolio_tools_exports_six_tools` (existing,
    `test_tools.py`) is updated to expect seven tools and renamed/adjusted
    accordingly; a new schema test confirms `create_snapshot`'s args match
    `name: str, description: str = ""`.

- [x] **T-014**: Tests for agent tool integration
  - **Files**: `apps/backend/tests/test_tools.py`, `apps/backend/tests/integration/test_tools_pg.py`
  - **Specs**: AL-005, SNAP-006
  - **Description**: Unit-level: extend the existing tool-count and schema
    tests (T-012/T-013 acceptance). Integration-level (using `patch_get_pool`
    + `tool_config` fixtures, same pattern as existing `test_tools_pg.py`):
    invoke `add_product` via `.ainvoke()` and assert a `portfolio_changes`
    row exists with `source='agent'`; invoke `create_snapshot` and assert a
    `portfolio_snapshots` row is created for the calling `user_id`.
  - **Acceptance**: `pytest apps/backend/tests/test_tools.py apps/backend/tests/integration/test_tools_pg.py -q` passes.

### PR 5: REST API Endpoints

- [x] **T-015**: Add `SnapshotCreate` request model and wire `VersioningRepository` into app state
  - **Files**: `apps/backend/src/db/models.py`, `apps/backend/src/api/routes.py`
  - **Specs**: SNAP-001 (request validation prerequisite)
  - **Description**: Add `class SnapshotCreate(BaseModel): name: str = Field(min_length=1, max_length=200); description: str = ""`
    to `db/models.py` (co-located with `ProductCreate`/`ProductUpdate`,
    matching existing convention). In `api/routes.py`'s `lifespan`, construct
    `app.state.versioning_repo = VersioningRepository(pool)` alongside the
    existing `app.state.repo`.
  - **Acceptance**: `POST` with `{"name": ""}` or omitted `name` returns
    `422` via Pydantic's `min_length=1` validation (SNAP-001 "Snapshot
    creation rejects an empty name") — no handler-level check needed.

- [x] **T-016**: Snapshot routes — create, list, detail
  - **Files**: `apps/backend/src/api/routes.py`
  - **Specs**: SNAP-001, SNAP-003, SNAP-004, SNAP-009, SNAP-010
  - **Description**: Add `POST /portfolio/me/snapshots` (201, body =
    `SnapshotCreate`), `GET /portfolio/me/snapshots` (list, `limit`/`offset`
    query params), `GET /portfolio/me/snapshots/{snapshot_id}` (detail, 404
    via `HTTPException` when `get_snapshot` returns `None`) — all behind
    `Depends(get_current_user)`, all delegating to `app.state.versioning_repo`.
    No `PATCH`/`PUT` route for snapshots (SNAP-005 — enforced by omission,
    same as the repository layer).
  - **Acceptance**: Unauthenticated request to any of the three routes
    returns `401`; `GET .../snapshots/{bogus-id}` returns `404`; a `PATCH`
    to `/portfolio/me/snapshots/{id}` returns FastAPI's default `405`
    (method not allowed on a registered path) or `404` (no path registered)
    — either satisfies SNAP-005.

- [x] **T-017**: Compare route
  - **Files**: `apps/backend/src/api/routes.py`
  - **Specs**: CMP-001, CMP-005, CMP-006, CMP-007
  - **Description**: Add `GET /portfolio/me/compare?a=:id&b=:id` (per
    design.md's route-ordering decision — using `/compare`, not
    `/snapshots/compare`, to avoid the FastAPI path-conflict with
    `/snapshots/{snapshot_id}`). Missing `a` or `b` returns `422`
    (FastAPI's default for a missing required query param — no extra
    handling needed). Catch the repository's not-found vs. cross-user-access
    exceptions (from T-009) and map to `404` vs `403` respectively — do not
    collapse both into one status code. A malformed (non-UUID) `a`/`b`
    should also surface as `422`.
  - **Acceptance**: All five CMP-001/CMP-005 scenarios (compare two owned
    snapshots, missing param, cross-user, non-existent id, malformed id)
    produce the exact status codes specified in the spec.

- [x] **T-018**: Change log route + admin read-only routes
  - **Files**: `apps/backend/src/api/routes.py`, `apps/backend/src/api/admin_routes.py`
  - **Specs**: AL-006, AL-007, SNAP-010
  - **Description**: Add `GET /portfolio/me/changes` (paginated,
    `operation` filter query param) to `api/routes.py`. Add
    `GET /admin/portfolios/{user_id}/changes` and
    `GET /admin/portfolios/{user_id}/snapshots` to `api/admin_routes.py`
    (same `router = APIRouter(prefix="/admin", ..., dependencies=[Depends(require_admin)])`
    pattern already used for `/admin/portfolios/{user_id}` — read-only,
    calling `versioning_repo.list_changes(user_id, ...)` /
    `list_snapshots(user_id, ...)` for the *target* user, never the admin's
    own id). No admin route may create/modify/delete a snapshot or change
    log entry for another user (AL-007, SNAP-010 — enforced by only adding
    `GET` routes here, mirroring the existing admin router's read-only
    pattern for portfolios).
  - **Acceptance**: A non-admin user gets `403` from the two new admin
    routes (via the existing `require_admin` dependency, already exercised
    by `test_admin_routes.py`); an admin hitting
    `GET /admin/portfolios/{user_id}/changes` for a client sees that
    client's changes with no route existing to mutate them.

- [x] **T-019**: Tests for versioning REST routes
  - **Files**: `apps/backend/tests/test_routes_guarded.py` or a new `apps/backend/tests/integration/test_versioning_routes_pg.py`
  - **Specs**: SNAP-001, SNAP-003, SNAP-004, SNAP-005, SNAP-009, SNAP-010, CMP-001, CMP-005, CMP-006, CMP-007, AL-006, AL-007
  - **Description**: Using the `app_client` fixture pattern already
    established in `test_routes_guarded.py` (dependency-overridden
    `get_current_user`, real Postgres via `ASGITransport`), drive every
    route added in T-016/T-017/T-018 through the full FastAPI stack —
    auth-required (`401`), ownership-scoped (`403`/`404`), and
    happy-path (`200`/`201`) cases.
  - **Acceptance**: `pytest apps/backend/tests -q` (full backend suite)
    passes with no regressions in previously-passing tests.

### PR 6: Frontend Data Layer + Snapshot Creation UI

- [x] **T-020**: `usePortfolioVersioning` hook — snapshot slice
  - **Files**: `apps/web/lib/usePortfolioVersioning.ts` (new)
  - **Specs**: SNAP-001, SNAP-003, SNAP-009 (frontend consumption)
  - **Description**: New hook following `usePortfolio.ts`'s conventions
    (`fetchWithAuth`, `useCallback`/`useState`, router redirect to `/login`
    on `401`). Implement the `snapshots`, `isLoadingSnapshots`,
    `fetchSnapshots`, `createSnapshot` slice of the `UsePortfolioVersioningResult`
    interface from design.md. Per the SNAP-009 deviation flagged above: do
    **not** disable snapshot creation when `productCount === 0` — the
    backend now supports empty-portfolio snapshots.
  - **Acceptance**: `createSnapshot(name)` posts to
    `/api/portfolio/me/snapshots`, and on success calls `fetchSnapshots()`
    to refresh the list (matching `usePortfolio`'s refetch-after-mutation
    convention, no cross-hook event needed per design.md → "State
    Management").

- [x] **T-021**: `SnapshotButton` + `SnapshotModal`
  - **Files**: `apps/web/components/portfolio/SnapshotButton.tsx` (new), `apps/web/components/portfolio/SnapshotModal.tsx` (new)
  - **Specs**: SNAP-007
  - **Description**: `SnapshotButton` renders inline near `MetricsRow` in
    `PortfolioPanel`'s header area (design.md → "Where components mount").
    `SnapshotModal` follows `EditProductModal.tsx`'s overlay-modal
    conventions (same `inputClass` styling token pattern, Escape/overlay-click
    to close without saving) with a required name input and optional
    description textarea. Empty-name submission is blocked client-side with
    an inline validation message before any request is sent (SNAP-007
    "Empty name is blocked client-side").
  - **Acceptance**: Clicking "Guardar" with an empty name shows inline
    validation and sends no request; a valid submit calls
    `createSnapshot(name, description)` and closes the modal with a toast
    confirmation (via the existing `useToast` hook) on success.

- [x] **T-022**: `VersioningBar` + `PortfolioPanel` integration
  - **Files**: `apps/web/components/portfolio/VersioningBar.tsx` (new), `apps/web/components/portfolio/PortfolioPanel.tsx`
  - **Specs**: SNAP-007 (surrounding UI), AL-008 (partial — activity indicator only, full drawer is PR7)
  - **Description**: New thin bar between the `MetricsRow`/`CategoryTabs`
    header and the scrollable category content (design.md → "Where
    components mount"), showing snapshot count and a "Ver historial" link
    (link is a no-op placeholder in this PR — wired to open
    `VersioningDrawer` in PR7). Mount `usePortfolioVersioning()` at the
    `PortfolioPanel` level and pass `SnapshotButton`/`VersioningBar` their
    handlers, mirroring how `usePortfolio()` is currently wired.
  - **Acceptance**: `PortfolioPanel` renders `SnapshotButton` and
    `VersioningBar` without breaking any existing `usePortfolio`-driven
    behavior (metrics, tabs, category sections all render unchanged).

- [x] **T-023**: Frontend tests for snapshot creation flow
  - **Files**: `apps/web/__tests__/snapshot-creation.test.tsx` (new)
  - **Specs**: SNAP-001, SNAP-007
  - **Description**: Following the existing `__tests__/*.test.tsx` conventions
    (`@testing-library/react` + `vitest`, see `propose-product-card.test.tsx`
    for the project's mocking pattern for `fetchWithAuth`), test: empty-name
    submission blocked client-side; successful creation calls the POST
    endpoint with the entered name/description and triggers a refetch;
    error response surfaces a visible error state (not a silent failure).
  - **Acceptance**: `yarn workspace web test` (or `vitest run
    snapshot-creation`) passes.

### PR 7: Frontend History Drawer + Comparison View

- [x] **T-024**: `usePortfolioVersioning` hook — comparison + change-log slices
  - **Files**: `apps/web/lib/usePortfolioVersioning.ts`
  - **Specs**: CMP-001, CMP-005, AL-006 (frontend consumption)
  - **Description**: Extend the hook from T-020 with the `comparison`,
    `isComparing`, `compareSnapshots`, `clearComparison`, `changes`,
    `isLoadingChanges`, `fetchChanges` slice of the design.md interface.
    `compareSnapshots(aId, bId)` calls `GET /api/portfolio/me/compare?a=...&b=...`
    and surfaces a distinguishable error state (not a blank result) when the
    request fails (CMP-005 "Frontend surfaces a compare error").
  - **Acceptance**: A failed compare request (mocked 404) sets an error
    state the UI can render, without leaving `comparison` in a stale or
    ambiguous partial state.

- [x] **T-025**: `VersioningDrawer` + `SnapshotList`/`SnapshotItem`
  - **Files**: `apps/web/components/portfolio/VersioningDrawer.tsx` (new), `apps/web/components/portfolio/SnapshotList.tsx` (new)
  - **Specs**: SNAP-008
  - **Description**: Right-side slide-over per design.md's component
    hierarchy, with `DrawerTabs` for "Snapshots" | "Changes". `SnapshotList`
    renders all snapshots newest-first with name/date/product count;
    selecting one opens a read-only detail view (no edit/delete controls,
    live portfolio unaffected — SNAP-008 "Selecting a snapshot opens a
    read-only detail view"). Wire `VersioningBar`'s "Ver historial" link
    (from T-022) to open this drawer.
  - **Acceptance**: Opening the drawer with 5 snapshots lists all 5,
    newest first; selecting one renders a read-only product list with no
    interactive edit/delete affordances present in the DOM.

- [x] **T-026**: `ChangeLog` + `ChangeLogItem`
  - **Files**: `apps/web/components/portfolio/ChangeLog.tsx` (new)
  - **Specs**: AL-006, AL-008
  - **Description**: Paginated list inside the drawer's "Changes" tab —
    operation badge (create/update/delete), product name (from
    `before_state`/`after_state`), source icon (agent/api/admin), and
    human-readable timestamp, reverse-chronological (AL-008 "Expandable
    history shows a chronological list"). Also add a lightweight recent-activity
    indicator elsewhere in `PortfolioPanel` (e.g. inside `VersioningBar`)
    that reflects the latest change after a chat-stream-triggered refetch
    (AL-008 "Recent activity indicator shows latest mutation") — reuse the
    existing `PORTFOLIO_REFETCH_EVENT` listener pattern from `usePortfolio.ts`
    rather than inventing a new event.
  - **Acceptance**: A newly-created product (via chat) triggers the drawer's
    change log (when open) and the recent-activity indicator to reflect it
    after the existing post-stream refetch, without a page reload.

- [x] **T-027**: `ComparisonView` + `DiffSection`
  - **Files**: `apps/web/components/portfolio/ComparisonView.tsx` (new)
  - **Specs**: CMP-004, CMP-005
  - **Description**: Full-width modal or slide-over per design.md's
    hierarchy: `ComparisonHeader` (snapshot A vs. B name/date),
    `DiffSection` for Added (green), Removed (red), Modified (amber, with
    inline per-field before→after deltas, not a generic "changed" label —
    CMP-004 "Modified product shows field-level deltas inline"). An explicit
    "no changes" state when all three lists are empty (CMP-004 "No
    differences found") — do not render three empty, unexplained sections.
    Surface compare-request errors from T-024's error state instead of a
    blank/partial render (CMP-005).
  - **Acceptance**: Comparing two identical snapshots shows an explicit
    "sin cambios" (or equivalent) message, not three empty headers; a
    modified product's amount change renders as e.g. "USD 100,000 →
    USD 130,000" inline, not just an amber highlight.

- [x] **T-028**: Frontend tests for history drawer and comparison view
  - **Files**: `apps/web/__tests__/versioning-drawer.test.tsx` (new), `apps/web/__tests__/comparison-view.test.tsx` (new)
  - **Specs**: SNAP-008, CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, AL-008
  - **Description**: Drawer: snapshot list ordering, read-only detail
    view has no edit/delete controls. Comparison view: added/removed/modified
    sections render with correct color coding and per-field deltas from a
    mocked `SnapshotDiff` payload; self-comparison (`added`/`removed`/
    `modified` all empty) renders the explicit no-changes state; a mocked
    compare-endpoint failure renders a visible error, not a blank panel.
  - **Acceptance**: `yarn workspace web test` passes, including both new
    test files.

---

## Traceability Matrix

| Requirement | Covered by |
|---|---|
| AL-001 | T-002, T-003, T-004 |
| AL-002 | T-002, T-003, T-004 |
| AL-003 | T-002, T-003, T-004 |
| AL-004 | T-003, T-004 |
| AL-005 | T-003, T-004, T-012, T-014 |
| AL-006 | T-010, T-011, T-018, T-019, T-024, T-026 |
| AL-007 | T-010, T-011, T-018, T-019 |
| AL-008 | T-022, T-026 |
| SNAP-001 | T-002, T-005, T-008, T-015, T-016, T-019, T-020, T-023 |
| SNAP-002 | T-002, T-005, T-008 |
| SNAP-003 | T-006, T-008, T-016, T-019, T-020 |
| SNAP-004 | T-006, T-008, T-016, T-019 |
| SNAP-005 | T-006, T-016, T-019 |
| SNAP-006 | T-013, T-014 |
| SNAP-007 | T-016, T-019, T-021, T-022, T-023 |
| SNAP-008 | T-025, T-028 |
| SNAP-009 | T-005, T-008, T-016, T-019, T-020 |
| SNAP-010 | T-006, T-008, T-016, T-018, T-019 |
| SNAP-011 | T-005, T-007 |
| CMP-001 | T-009, T-011, T-017, T-019 |
| CMP-002 | T-009, T-011, T-028 |
| CMP-003 | T-009, T-011, T-028 |
| CMP-004 | T-027, T-028 |
| CMP-005 | T-017, T-019, T-024, T-027, T-028 |
| CMP-006 | T-009, T-011, T-017, T-028 |
| CMP-007 | T-009, T-011, T-017 |

All 26 requirements (AL-001..008, SNAP-001..011, CMP-001..007) have at least
one covering task.
