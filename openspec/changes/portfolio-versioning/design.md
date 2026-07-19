# Design: Portfolio Versioning

## Architecture Decision Records

### ADR-1: Transaction-Wrapped Audit Logging via Connection-Level Transactions

**Decision**: Wrap every product mutation (create/update/delete) together with its `portfolio_changes` INSERT in a single `asyncpg` connection-level transaction using `async with pool.acquire() as conn` + `async with conn.transaction()`. The `ProductRepository` methods gain an optional `conn: asyncpg.Connection | None` parameter; when provided, they use that connection instead of `self.pool` directly. A new internal helper `_log_change(conn, ...)` writes the audit row within the same transaction.

**Rationale**: The current `ProductRepository` uses `self.pool.execute()` / `self.pool.fetchrow()` which acquires and releases a connection per statement — no transaction boundary. For atomicity between the product mutation and the audit log (proposal risk: "if the mutation succeeds but the log fails, we lose auditability"), we need explicit transactions. Passing an optional `conn` keeps the existing API backwards-compatible while enabling transactional use.

**Alternatives considered**:
- *Postgres trigger on `products` table*: Automatically fires on INSERT/UPDATE/DELETE and writes to `portfolio_changes`. Pros: zero app-code changes for logging. Cons: cannot capture `source` (agent/api/admin) or `metadata` (thread_id, tool name) since triggers only see the row, not the application context. Rejected because source attribution is a core requirement.
- *Event-sourcing (append-only log as source of truth)*: Pros: perfect auditability. Cons: massive architectural shift for this project, incompatible with the existing direct-mutation model. Out of scope per proposal boundaries.
- *After-the-fact async log (write audit log in a background task)*: Pros: no latency impact. Cons: audit entries could be lost on crash, defeating the purpose. Rejected.

### ADR-2: Separate `snapshot_products` Table with JSONB Product Data

**Decision**: Store snapshot product state in a dedicated `snapshot_products` table where each row holds one product's full state as a JSONB column (`product_data`). Each row also stores `product_id` (the original product's TEXT id) as a plain indexed column to enable efficient diff matching.

**Rationale**: The proposal suggested this approach, and it's correct. Alternatives:
- *Single JSONB array on `portfolio_snapshots`*: Simpler schema but makes per-product querying, indexing, and comparison harder. For a 30-product portfolio this is trivial, but the separate table enables `JOIN`-based diffing and future features (search within snapshots, per-product history across snapshots).
- *Storing only product IDs + relying on `portfolio_changes`*: Would require replaying the change log to reconstruct state — complex and fragile.

**Alternatives considered**: See above inline.

### ADR-3: Diff by `product_id` with JSONB Field Comparison

**Decision**: The comparison algorithm matches products between two snapshots by `product_id` (stable primary key from `products` table, stored in `snapshot_products.product_data->>'id'` and in the dedicated `product_id` column). Products present in snapshot A but not B are "removed"; in B but not A are "added"; in both are compared field-by-field using application-level Python dict comparison (not Postgres `jsonb_diff`).

**Rationale**: `product_id` is stable (generated once at creation, never changes). Matching by name would break on renames. Doing the diff in Python (not a Postgres function) keeps the logic testable, debuggable, and avoids depending on Postgres extensions. Given portfolio sizes (5-30 products), the performance cost of fetching both snapshots' products and diffing in Python is negligible.

**Alternatives considered**:
- *Postgres `jsonb_each` + set operations*: Possible but harder to unit test and produces less readable diff output for the frontend.
- *Store pre-computed diff at snapshot creation*: Rejected — you can't know in advance which pairs the user will compare.

### ADR-4: Source Propagation via Explicit `source` Parameter

**Decision**: Add an optional `source: str = "api"` parameter to `ProductRepository.create()`, `.update()`, and `.delete()`. Agent tools pass `source="agent"`, REST API routes pass `source="api"` (default), and admin routes pass `source="admin"`. This parameter is forwarded to `_log_change()` within the transaction.

**Rationale**: The simplest approach that doesn't require middleware, context vars, or framework magic. The call sites are few and well-defined (3 tools + 3 routes + admin routes). Context variables (`contextvars`) were considered but add implicit coupling and are harder to trace in async code.

### ADR-5: Snapshot Isolation via SELECT FOR SHARE

**Decision**: When creating a snapshot, acquire a connection, begin a transaction with `REPEATABLE READ` isolation, select all products for the user with `FOR SHARE` (prevents concurrent deletes/updates from committing until the snapshot read completes), then INSERT the snapshot and its products within that same transaction.

**Rationale**: `SERIALIZABLE` (proposed) is overkill and can cause serialization failures that need retry logic. `REPEATABLE READ` + `FOR SHARE` gives us a consistent read of the product set while allowing concurrent reads and blocking only concurrent writes to those specific rows — just long enough to copy them into `snapshot_products`. The lock duration is short (a few ms for 30 products).

---

## Database Schema

### Migration: `versioning_schema.sql`

This file is appended to `schema.sql` (same pattern as existing `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` blocks):

```sql
-- Portfolio Versioning: Snapshots
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    product_count INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_created
    ON portfolio_snapshots (user_id, created_at DESC);

-- Portfolio Versioning: Snapshot Products (materialized state)
CREATE TABLE IF NOT EXISTS snapshot_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_products_snapshot
    ON snapshot_products (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_products_product_id
    ON snapshot_products (product_id);

-- Portfolio Versioning: Change Log (audit trail)
CREATE TABLE IF NOT EXISTS portfolio_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    before_state JSONB,
    after_state JSONB,
    source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('agent', 'api', 'admin')),
    snapshot_id UUID REFERENCES portfolio_snapshots(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changes_user_created
    ON portfolio_changes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_changes_product
    ON portfolio_changes (product_id);

CREATE INDEX IF NOT EXISTS idx_changes_snapshot
    ON portfolio_changes (snapshot_id)
    WHERE snapshot_id IS NOT NULL;
```

### Migration Strategy

- **Zero-downtime**: All statements use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` — safe to run against an existing database. No `ALTER TABLE` on existing tables.
- **Existing data**: No backfill needed. Existing products have no history; the first snapshot a user creates becomes their baseline. This is documented in the proposal as acceptable.
- **Auto-apply**: Append the new SQL to `apps/backend/src/db/schema.sql`. The existing `_run_schema()` in `connection.py` runs the full file on pool init — new tables are created automatically on first startup.

---

## Backend Architecture

### Repository Layer Changes (`db/repository.py`)

The `ProductRepository` gains:
1. An optional `conn` parameter on mutating methods (enables transaction sharing)
2. An internal `_log_change()` helper
3. A `source` parameter on each mutating method

```python
# New method signatures (replacing existing ones):

async def create(
    self,
    user_id: str,
    data: ProductCreate,
    *,
    source: str = "api",
    metadata: dict | None = None,
    conn: asyncpg.Connection | None = None,
) -> Product:
    ...

async def update(
    self,
    product_id: str,
    data: ProductUpdate,
    *,
    source: str = "api",
    metadata: dict | None = None,
    conn: asyncpg.Connection | None = None,
) -> Product | None:
    ...

async def delete(
    self,
    product_id: str,
    *,
    source: str = "api",
    metadata: dict | None = None,
    conn: asyncpg.Connection | None = None,
) -> bool:
    ...
```

**Transaction pattern** (applied identically to create/update/delete):

```python
async def create(self, user_id: str, data: ProductCreate, *, source: str = "api",
                 metadata: dict | None = None, conn: asyncpg.Connection | None = None) -> Product:
    # If no connection passed, acquire one and wrap in transaction
    if conn is None:
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                return await self._create_impl(conn, user_id, data, source, metadata)
    else:
        # Caller owns the transaction
        return await self._create_impl(conn, user_id, data, source, metadata)

async def _create_impl(self, conn: asyncpg.Connection, user_id: str,
                       data: ProductCreate, source: str, metadata: dict | None) -> Product:
    product_id = f"prod_{uuid.uuid4().hex[:8]}"
    await conn.execute("""INSERT INTO products ...""", ...)
    product = Product(id=product_id, user_id=user_id, **data.model_dump())
    await self._log_change(
        conn, user_id=user_id, product_id=product_id,
        operation="create", before_state=None,
        after_state=product.model_dump(),
        source=source, metadata=metadata,
    )
    return product
```

**`_log_change` helper**:

```python
async def _log_change(
    self,
    conn: asyncpg.Connection,
    *,
    user_id: str,
    product_id: str | None,
    operation: str,
    before_state: dict | None,
    after_state: dict | None,
    source: str,
    metadata: dict | None = None,
    snapshot_id: str | None = None,
) -> None:
    await conn.execute(
        """INSERT INTO portfolio_changes
           (user_id, product_id, operation, before_state, after_state,
            source, metadata, snapshot_id)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8)""",
        user_id,
        product_id,
        operation,
        json.dumps(before_state) if before_state else None,
        json.dumps(after_state) if after_state else None,
        source,
        json.dumps(metadata or {}),
        snapshot_id,
    )
```

**For `update`**: Before writing the update, fetch the current state (`SELECT * FROM products WHERE id = $1 FOR UPDATE`) to capture `before_state`. The `FOR UPDATE` within the transaction prevents concurrent modification between the read and write.

**For `delete`**: Before deleting, fetch the current state to capture `before_state` (full product serialized as JSONB). `after_state` is NULL for deletes.

### VersioningRepository (`db/versioning.py` — new file)

```python
from __future__ import annotations

import json
from typing import Any

import asyncpg

from db.models import Product


class VersioningRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def create_snapshot(
        self, user_id: str, name: str, description: str = ""
    ) -> dict:
        """Create an immutable snapshot of the user's current portfolio.

        Uses REPEATABLE READ + FOR SHARE to get a consistent view.
        Returns the snapshot metadata (id, name, product_count, total_amount, created_at).
        """
        ...

    async def list_snapshots(
        self, user_id: str, limit: int = 50, offset: int = 0
    ) -> list[dict]:
        """List snapshots for a user, newest first. Returns metadata only."""
        ...

    async def get_snapshot(self, snapshot_id: str, user_id: str) -> dict | None:
        """Get a single snapshot with its full product list.
        Returns None if not found or not owned by user_id.
        """
        ...

    async def compare_snapshots(
        self, snapshot_a_id: str, snapshot_b_id: str, user_id: str
    ) -> dict:
        """Compare two snapshots and return a structured diff.
        Both snapshots must belong to user_id.
        """
        ...

    async def list_changes(
        self, user_id: str, limit: int = 50, offset: int = 0,
        product_id: str | None = None,
    ) -> list[dict]:
        """Paginated change log for a user. Optionally filter by product_id."""
        ...
```

**`create_snapshot` implementation detail**:

```python
async def create_snapshot(self, user_id: str, name: str, description: str = "") -> dict:
    async with self.pool.acquire() as conn:
        async with conn.transaction(isolation="repeatable_read"):
            # Lock products for consistent read
            rows = await conn.fetch(
                "SELECT * FROM products WHERE user_id = $1 FOR SHARE",
                user_id,
            )
            if not rows:
                raise ValueError("Cannot create snapshot of an empty portfolio")

            total_amount = sum(float(r["amount"]) for r in rows)
            product_count = len(rows)

            # Create snapshot header
            snapshot_row = await conn.fetchrow(
                """INSERT INTO portfolio_snapshots
                   (user_id, name, description, product_count, total_amount)
                   VALUES ($1, $2, $3, $4, $5)
                   RETURNING id, created_at""",
                user_id, name, description, product_count, total_amount,
            )
            snapshot_id = snapshot_row["id"]

            # Materialize each product into snapshot_products
            for row in rows:
                product_data = {
                    "id": str(row["id"]),
                    "name": row["name"],
                    "provider": row["provider"] or "",
                    "amount": float(row["amount"]),
                    "category": row["category"],
                    "subcategory": row["subcategory"] or "",
                    "composition": row["composition"] if isinstance(row["composition"], list)
                                   else json.loads(row["composition"] or "[]"),
                    "asset_class": row.get("asset_class") or "",
                    "geographic_focus": row.get("geographic_focus") or "",
                    "underlying": row.get("underlying") or "",
                    "commission": row.get("commission") or "",
                    "currency": row.get("currency") or "",
                    "administrator": row.get("administrator") or "",
                    "manager": row.get("manager") or "",
                    "liquidity": row.get("liquidity") or "",
                    "return_rate": row.get("return_rate") or "",
                    "catalog_product_id": row.get("catalog_product_id"),
                }
                await conn.execute(
                    """INSERT INTO snapshot_products (snapshot_id, product_id, product_data)
                       VALUES ($1, $2, $3::jsonb)""",
                    snapshot_id, str(row["id"]), json.dumps(product_data),
                )

            return {
                "id": str(snapshot_id),
                "name": name,
                "description": description,
                "product_count": product_count,
                "total_amount": float(total_amount),
                "created_at": snapshot_row["created_at"].isoformat(),
            }
```

**`compare_snapshots` implementation detail**:

```python
async def compare_snapshots(
    self, snapshot_a_id: str, snapshot_b_id: str, user_id: str
) -> dict:
    # Verify ownership of both snapshots
    for sid in (snapshot_a_id, snapshot_b_id):
        owner = await self.pool.fetchval(
            "SELECT user_id FROM portfolio_snapshots WHERE id = $1", sid
        )
        if str(owner) != user_id:
            raise ValueError(f"Snapshot {sid} not found or access denied")

    # Fetch products for both snapshots
    rows_a = await self.pool.fetch(
        "SELECT product_id, product_data FROM snapshot_products WHERE snapshot_id = $1",
        snapshot_a_id,
    )
    rows_b = await self.pool.fetch(
        "SELECT product_id, product_data FROM snapshot_products WHERE snapshot_id = $1",
        snapshot_b_id,
    )

    products_a = {r["product_id"]: json.loads(r["product_data"]) if isinstance(r["product_data"], str)
                  else r["product_data"] for r in rows_a}
    products_b = {r["product_id"]: json.loads(r["product_data"]) if isinstance(r["product_data"], str)
                  else r["product_data"] for r in rows_b}

    ids_a = set(products_a.keys())
    ids_b = set(products_b.keys())

    added = [products_b[pid] for pid in (ids_b - ids_a)]
    removed = [products_a[pid] for pid in (ids_a - ids_b)]

    modified = []
    for pid in ids_a & ids_b:
        pa, pb = products_a[pid], products_b[pid]
        changes = {}
        for field in pa:
            if pa[field] != pb.get(field):
                changes[field] = {"from": pa[field], "to": pb.get(field)}
        if changes:
            modified.append({"product_id": pid, "name": pb.get("name", pa["name"]),
                             "changes": changes})

    return {
        "snapshot_a": snapshot_a_id,
        "snapshot_b": snapshot_b_id,
        "added": added,
        "removed": removed,
        "modified": modified,
        "summary": {
            "added_count": len(added),
            "removed_count": len(removed),
            "modified_count": len(modified),
        },
    }
```

### Agent Tools (`agent/tools.py`)

**Existing tools modified** — internal only, no external interface change:

```python
@tool
async def add_product(..., *, config: RunnableConfig) -> dict:
    repo = await _repository()
    user_id = _user_id(config)
    # Pass source="agent" and metadata with tool context
    product = await repo.create(
        user_id, ProductCreate(...),
        source="agent",
        metadata={"tool": "add_product"},
    )
    return {"status": "added", "product": product.model_dump()}
```

Same pattern for `update_product` (pass `source="agent"`, `metadata={"tool": "update_product"}`) and `delete_product` (pass `source="agent"`, `metadata={"tool": "delete_product"}`).

**New tool** — `create_snapshot`:

```python
@tool
async def create_snapshot(
    name: str,
    description: str = "",
    *,
    config: RunnableConfig,
) -> dict:
    """Save the current portfolio as a named, immutable snapshot.

    Call this at natural breakpoints: after processing a document upload,
    after completing a restructuring conversation, or when the user
    explicitly asks to save a version.

    Args:
        name: Short descriptive name for this snapshot (e.g. 'Pre-Q3 Review',
              'After Document Upload - Jul 2026').
        description: Optional longer description of what this snapshot represents.
    """
    from db.versioning import VersioningRepository

    pool = await get_pool()
    versioning_repo = VersioningRepository(pool)
    user_id = _user_id(config)

    try:
        snapshot = await versioning_repo.create_snapshot(user_id, name, description)
        return {"status": "created", "snapshot": snapshot}
    except ValueError as e:
        return {"status": "error", "message": str(e)}
```

**Update `portfolio_tools` list**:

```python
portfolio_tools = [
    search_product,
    propose_product,
    add_product,
    update_product,
    delete_product,
    get_portfolio_summary,
    create_snapshot,  # NEW
]
```

### API Endpoints (`api/routes.py`)

New routes added to the existing `app` FastAPI instance. All require `get_current_user` auth dependency.

**Snapshot endpoints**:

```python
@app.post("/portfolio/me/snapshots", status_code=201)
async def create_snapshot_route(
    body: SnapshotCreate,  # Pydantic: name: str, description: str = ""
    user: dict = Depends(get_current_user),
) -> dict:
    """Create a new named snapshot of the current portfolio state."""
    snapshot = await app.state.versioning_repo.create_snapshot(
        user["id"], body.name, body.description
    )
    return snapshot


@app.get("/portfolio/me/snapshots")
async def list_snapshots_route(
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user),
) -> dict:
    """List all snapshots for the current user, newest first."""
    snapshots = await app.state.versioning_repo.list_snapshots(
        user["id"], limit=limit, offset=offset
    )
    return {"snapshots": snapshots}


@app.get("/portfolio/me/snapshots/{snapshot_id}")
async def get_snapshot_route(
    snapshot_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """Get a single snapshot with its full product list."""
    snapshot = await app.state.versioning_repo.get_snapshot(snapshot_id, user["id"])
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return snapshot


@app.get("/portfolio/me/snapshots/compare")
async def compare_snapshots_route(
    a: str,  # query param: snapshot A id
    b: str,  # query param: snapshot B id
    user: dict = Depends(get_current_user),
) -> dict:
    """Compare two snapshots side by side."""
    try:
        diff = await app.state.versioning_repo.compare_snapshots(a, b, user["id"])
        return diff
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
```

**Change log endpoint**:

```python
@app.get("/portfolio/me/changes")
async def list_changes_route(
    limit: int = 50,
    offset: int = 0,
    product_id: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict:
    """Paginated change log for the current user's portfolio."""
    changes = await app.state.versioning_repo.list_changes(
        user["id"], limit=limit, offset=offset, product_id=product_id
    )
    return {"changes": changes}
```

**Route ordering note**: The `/portfolio/me/snapshots/compare` path must be registered BEFORE `/portfolio/me/snapshots/{snapshot_id}` to avoid FastAPI treating `compare` as a snapshot_id. Alternatively, use distinct path: `/portfolio/me/compare` with query params `?a=...&b=...`.

**Decision**: Use `/portfolio/me/compare?a=...&b=...` to avoid path conflict with the parametric `{snapshot_id}` route.

**Lifespan update** — add `versioning_repo` to `app.state`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = await get_pool()
    app.state.repo = ProductRepository(pool)
    app.state.versioning_repo = VersioningRepository(pool)  # NEW
    app.state.user_repo = UserRepository(pool)
    app.state.catalog_repo = CatalogRepository(pool)
    ...
```

**Request/response models** (added to `db/models.py` or a new `api/versioning_models.py`):

```python
class SnapshotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
```

---

## Frontend Architecture

### Data Layer

**New hook: `lib/usePortfolioVersioning.ts`**

```typescript
export interface Snapshot {
  id: string;
  name: string;
  description: string;
  product_count: number;
  total_amount: number;
  created_at: string;
}

export interface SnapshotDetail extends Snapshot {
  products: Product[];
}

export interface SnapshotDiff {
  snapshot_a: string;
  snapshot_b: string;
  added: Product[];
  removed: Product[];
  modified: Array<{
    product_id: string;
    name: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  }>;
  summary: { added_count: number; removed_count: number; modified_count: number };
}

export interface ChangeLogEntry {
  id: string;
  product_id: string | null;
  operation: "create" | "update" | "delete";
  before_state: Product | null;
  after_state: Product | null;
  source: "agent" | "api" | "admin";
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UsePortfolioVersioningResult {
  // Snapshots
  snapshots: Snapshot[];
  isLoadingSnapshots: boolean;
  fetchSnapshots: () => Promise<void>;
  createSnapshot: (name: string, description?: string) => Promise<Snapshot>;

  // Comparison
  comparison: SnapshotDiff | null;
  isComparing: boolean;
  compareSnapshots: (aId: string, bId: string) => Promise<void>;
  clearComparison: () => void;

  // Change log
  changes: ChangeLogEntry[];
  isLoadingChanges: boolean;
  fetchChanges: (opts?: { limit?: number; offset?: number }) => Promise<void>;
}
```

**API client functions** (inside the hook, using `fetchWithAuth`):

```typescript
// POST /api/portfolio/me/snapshots
// GET  /api/portfolio/me/snapshots
// GET  /api/portfolio/me/snapshots/:id
// GET  /api/portfolio/me/compare?a=:id&b=:id
// GET  /api/portfolio/me/changes
```

### Component Hierarchy

```
PortfolioPanel (existing)
├── MetricsRow (existing)
│   └── [New] SnapshotButton (inline in metrics header area)
├── CategoryTabs (existing)
├── [New] VersioningBar (thin strip below metrics — snapshot count + "History" link)
├── CategorySection[] (existing)
└── [New] SnapshotModal (create snapshot — name input + confirm)
    
[New] VersioningDrawer (slide-over from right, triggered by "History" link)
├── DrawerTabs: "Snapshots" | "Changes"
├── SnapshotList (timeline of snapshots with metadata)
│   └── SnapshotItem (clickable — opens detail or triggers comparison)
├── ChangeLog (paginated list of recent mutations)
│   └── ChangeLogItem (operation badge, product name, timestamp, source icon)
└── ComparisonView (when two snapshots selected)
    ├── ComparisonHeader (snapshot A name/date vs snapshot B name/date)
    ├── DiffSection: Added (green)
    ├── DiffSection: Removed (red)
    └── DiffSection: Modified (amber, with per-field deltas)
```

**Where components mount**:

- `SnapshotButton`: Inside the `MetricsRow` area or as a small icon-button in the portfolio panel header (next to the existing "Estado" metric card).
- `VersioningBar`: New thin horizontal bar between the `MetricsRow`/`CategoryTabs` header and the scrollable category content. Shows "N snapshots" + a clickable "Ver historial" link.
- `SnapshotModal`: Simple modal with a text input for name, optional description textarea, and "Guardar" button. Same pattern as `EditProductModal`.
- `VersioningDrawer`: Right-side slide-over panel (using Tailwind transforms/transitions), consistent with the existing modal overlay pattern but slide-over for richer content.

### State Management

- **No global state manager needed**: The versioning hook manages its own local state, same as `usePortfolio`.
- **Communication with portfolio panel**: The `SnapshotButton` and `VersioningBar` are rendered inside `PortfolioPanel` and receive their handlers from `usePortfolioVersioning()` called at the `PortfolioPanel` level.
- **Drawer open/close**: Simple `useState<boolean>` in `PortfolioPanel`.
- **Comparison selection**: Two-step flow in the drawer — user clicks "Comparar" on one snapshot (selected as A), then clicks another (selected as B). State: `selectedForCompare: [string | null, string | null]`.
- **Refetch trigger**: After creating a snapshot, call `fetchSnapshots()` to refresh the list. No cross-hook event needed because snapshot creation doesn't change the product data.

---

## Migration Strategy

1. **Schema addition**: Append the new `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements to `apps/backend/src/db/schema.sql`. Because the startup `_run_schema()` runs the entire file (and uses `IF NOT EXISTS`), existing tables are unaffected and new tables are created on the next startup. Zero-downtime for existing deployments.

2. **No backfill**: Existing products have no change history and no snapshots. The first user-created (or agent-created) snapshot becomes the baseline. Change log entries begin accruing from the moment the new code deploys.

3. **Rolling deploy safety**: The new columns/tables don't affect existing queries. If the frontend deploys before the backend, the new UI endpoints will 404 gracefully (the frontend must handle this). If the backend deploys first, the new routes exist but nobody calls them until the frontend ships.

4. **Rollback plan**: Dropping the three new tables (`portfolio_changes`, `portfolio_snapshots`, `snapshot_products`) reverts the schema. No existing table is modified, so rollback is clean.

---

## Key Implementation Details

### Transaction Patterns

The `ProductRepository` currently uses implicit single-statement transactions via `self.pool.execute()`. After this change, mutating methods use explicit transactions:

```python
async with self.pool.acquire() as conn:
    async with conn.transaction():
        # mutation + audit log INSERT — atomic
```

When an external caller needs to wrap multiple repository calls in one transaction (e.g., batch operations), they can pass their own `conn`:

```python
async with pool.acquire() as conn:
    async with conn.transaction():
        await repo.create(user_id, data1, source="agent", conn=conn)
        await repo.create(user_id, data2, source="agent", conn=conn)
```

### JSONB Serialization

Product state is serialized using `model_dump()` (Pydantic v2) for `after_state`/`before_state` in the change log and `product_data` in snapshot products. The `composition` field (list of dicts) is stored as-is within the JSONB — no double-serialization (no `json.dumps` of an already-dict field).

`asyncpg` handles Python `dict` → Postgres `jsonb` natively when the query uses `$N::jsonb` cast. We pass `json.dumps(state_dict)` as a string with `::jsonb` cast (matching the project's existing pattern in `repository.py` for `composition`).

### Diff Algorithm

The comparison is computed on-demand (not pre-computed) by `compare_snapshots()`:

1. Fetch all `snapshot_products` rows for both snapshots (2 queries).
2. Build `{product_id: product_data}` dicts for both.
3. Set difference for added/removed.
4. For common product_ids, compare all fields and collect deltas.
5. Skip `id` and `user_id` fields in the delta comparison (they never change meaningfully).

The diff output uses the structure the frontend needs directly — no further transformation needed in the API layer.

### Concurrent Access Handling

- **Snapshot creation**: `REPEATABLE READ` + `FOR SHARE` prevents a concurrent mutation from committing during the snapshot read, ensuring a consistent point-in-time copy.
- **Change log writes**: Wrapped in the same transaction as the mutation — if the transaction fails, both the mutation and the log entry are rolled back.
- **Multiple concurrent snapshot creations**: Safe — each runs in its own transaction and reads a consistent state.
- **Reading snapshots/changes**: No locking needed — these are immutable after creation (snapshots) or append-only (changes).

### Performance Considerations

- **Change log growth**: Indexed on `(user_id, created_at DESC)` for the paginated list query. `LIMIT/OFFSET` pagination is acceptable given typical volumes (<1000 changes per user per year). If this grows, cursor-based pagination can be added later using `created_at < $cursor`.
- **Snapshot product materialization**: For 30 products, the INSERT loop adds ~30 rows per snapshot. Using `executemany` or a single `INSERT ... VALUES` with unnest could optimize this but is premature — 30 individual inserts within a single transaction complete in <10ms on localhost.
- **Comparison queries**: Fetching 2 x 30 product rows and diffing in Python is negligible. No optimization needed at current scale.

### Frontend Error Handling

- **Empty portfolio**: The `create_snapshot` endpoint returns 400 (via `ValueError`) if the portfolio is empty. The frontend disables the snapshot button when `productCount === 0`.
- **Network errors**: Same `fetchWithAuth` pattern — 401 triggers refresh, other errors surface via the hook's error state.
- **Concurrent snapshot creation**: Idempotent names are not enforced (users can create multiple snapshots with the same name). Each has a unique UUID. The UI shows timestamps to disambiguate.

### Proxy Route Compatibility

The new endpoints (`/portfolio/me/snapshots`, `/portfolio/me/compare`, `/portfolio/me/changes`) all fall under the `/portfolio/*` prefix, which the Next.js API proxy already routes to `PORTFOLIO_API_URL` (FastAPI). No proxy changes needed.
