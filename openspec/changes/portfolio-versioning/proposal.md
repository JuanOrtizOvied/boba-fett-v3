# Proposal: Portfolio Versioning

## Intent

SABBI users build portfolios through iterative conversations with the AI agent, often over multiple sessions. Today, every `add_product`, `update_product`, and `delete_product` operation is a destructive mutation with no history — once the agent restructures a portfolio in a meeting, the previous state is gone. Users cannot answer "what did my portfolio look like before that last conversation?" or "what changed between our Q2 and Q3 reviews?" This makes SABBI unsuitable for professional advisory workflows where audit trails and before/after comparisons are table stakes.

Portfolio Versioning adds an automatic change log (every mutation tracked), named snapshots (user-saved immutable checkpoints), and side-by-side comparison (diff two snapshots to see what changed). Together these turn SABBI from a one-shot builder into a portfolio evolution tool.

## Capabilities

1. **Automatic change log**: Every product mutation (create, update, delete) records a timestamped entry with the operation type, before/after field values, and the trigger source (agent tool call, manual CRUD via REST API, or admin action).
2. **Named snapshots**: Users can save the current portfolio state as an immutable, named version at any point. Snapshots capture a full materialized copy of all products at that instant.
3. **Snapshot comparison**: Users can select two snapshots and view a structured diff — products added, removed, and modified (with per-field deltas for amounts, categories, composition changes).
4. **Agent-initiated snapshots**: The AI agent can suggest creating a snapshot at natural breakpoints (e.g., after processing a document upload or completing a restructuring conversation).
5. **Snapshot listing and navigation**: Users can view a timeline of all their snapshots and jump to any historical state (read-only view, no time-travel mutation).

## User Stories

- As an **investor**, I want to see what changed in my portfolio after each conversation with the AI agent, so that I can audit the agent's decisions.
- As an **investor**, I want to save a named version of my portfolio before a meeting with my advisor, so that I can compare it with the post-meeting version.
- As an **investor**, I want to compare two portfolio versions side by side, so that I can understand the evolution of my allocation strategy over time.
- As an **investor**, I want the system to automatically track every add/update/delete, so that nothing happens to my portfolio without a record.
- As an **advisor (admin)**, I want to see the change history of a client's portfolio, so that I can understand how the portfolio evolved across sessions.

## Scope Boundaries

### In Scope

- New `portfolio_changes` table (audit log) capturing every mutation with before/after JSONB, timestamp, source (agent/api/admin), and optional snapshot reference
- New `portfolio_snapshots` table storing named, immutable point-in-time copies of the full product set
- New `snapshot_products` table (or JSONB column) materializing the product state at snapshot time
- Modification of `ProductRepository` to emit change log entries on every `create`, `update`, `delete`
- Modification of agent tools (`add_product`, `update_product`, `delete_product`) to pass source metadata (`source: "agent"`) through to the repository
- REST API routes: `POST /portfolio/me/snapshots` (create), `GET /portfolio/me/snapshots` (list), `GET /portfolio/me/snapshots/:id` (detail), `GET /portfolio/me/snapshots/compare?a=:id&b=:id` (diff)
- REST API route: `GET /portfolio/me/changes` (paginated change log)
- Frontend: snapshot creation UI (button + name input in portfolio panel header)
- Frontend: snapshot list / timeline view (slide-over or modal)
- Frontend: comparison view (side-by-side or unified diff of two snapshots)
- New agent tool: `create_snapshot` — allows agent to save a named version when contextually appropriate
- Change log entries visible in the portfolio panel (recent activity indicator or expandable history)

### Out of Scope

- **Rollback / restore**: Viewing historical state is in scope; reverting the live portfolio to a past snapshot is NOT (future work — requires conflict resolution strategy)
- **Branching / forking**: No multiple parallel portfolio versions or "what-if" branches
- **Granular field-level undo**: No per-field undo within a single product
- **Change log for non-portfolio entities**: Only `products` mutations are tracked (not user settings, thread history, catalog changes)
- **Real-time collaboration / multi-user versioning**: Single-owner portfolio model is unchanged
- **Snapshot export to Excel**: Current export always reflects live state; snapshot-specific export is future work
- **Admin override of snapshots**: Admins can view but not modify/delete snapshots belonging to other users

## Technical Approach (high-level)

### Database Schema

```sql
-- Audit log: one row per mutation
CREATE TABLE portfolio_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    product_id TEXT,                          -- NULL for snapshot-only entries
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    before_state JSONB,                       -- NULL for creates
    after_state JSONB,                        -- NULL for deletes
    source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('agent', 'api', 'admin')),
    snapshot_id UUID REFERENCES portfolio_snapshots(id),  -- if this change is part of a snapshot
    metadata JSONB DEFAULT '{}',              -- tool name, thread_id, etc.
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Named immutable snapshots
CREATE TABLE portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    product_count INTEGER NOT NULL,
    total_amount NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Materialized product state at snapshot time (denormalized copy)
CREATE TABLE snapshot_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    product_data JSONB NOT NULL              -- full Product model serialized
);
```

### Backend Changes

- **`db/repository.py`**: Wrap `create`, `update`, `delete` to also INSERT into `portfolio_changes`. Accept an optional `source` parameter.
- **`db/versioning.py`** (new): `VersioningRepository` with `create_snapshot`, `list_snapshots`, `get_snapshot`, `compare_snapshots`, `list_changes`.
- **`agent/tools.py`**: Pass `source="agent"` to repository calls. Add new `create_snapshot` tool.
- **`api/routes.py`**: Add versioning endpoints under `/portfolio/me/snapshots` and `/portfolio/me/changes`.

### Frontend Changes

- **`lib/usePortfolioVersioning.ts`** (new hook): Fetch snapshots, create snapshot, trigger comparison.
- **Snapshot button** in `PortfolioPanel` header — opens a name-input popover, calls `POST /portfolio/me/snapshots`.
- **History/timeline panel** — lists snapshots with timestamps, accessible from a tab or icon in the metrics row.
- **Comparison view** — full-width modal or slide-over showing two snapshots side by side with color-coded diffs (green = added, red = removed, yellow = modified).

### Agent Integration

- New `create_snapshot` tool bound to the LLM: triggered when the agent detects a natural breakpoint (after document processing, after multiple mutations, or when the user requests it).
- Existing tools (`add_product`, `update_product`, `delete_product`) gain a `source` field internally but their external interface does not change.

## Risks & Open Questions

| Risk / Question | Severity | Notes |
|-----------------|----------|-------|
| **Storage growth**: `snapshot_products` duplicates full product data per snapshot. At typical portfolio sizes (5-30 products), this is negligible. At scale, consider storing only deltas. | Low | 30 products * 2KB * 50 snapshots = ~3MB per user — acceptable |
| **Change log volume**: High-frequency agent mutations (e.g., processing a 20-product document) could generate many log entries in one session. Need pagination and filtering on the frontend. | Low | Solved by pagination + optional session grouping |
| **Transaction integrity**: Change log INSERT must be atomic with the product mutation — if the mutation succeeds but the log fails, we lose auditability. Wrap in a single transaction. | Medium | Use Postgres transactions in repository layer |
| **Snapshot consistency**: Creating a snapshot must capture ALL products at a single point in time — no partial reads if a concurrent mutation is in flight. | Medium | Use `SERIALIZABLE` or explicit row locking during snapshot creation |
| **Comparison algorithm**: How to match products across snapshots when a product was deleted and re-created with the same name? Match by `product_id` (stable), not by name. | Low | Product IDs are stable — use them as the diff key |
| **Agent tool discoverability**: Should the agent proactively suggest snapshots, or only create them when the user asks? | Low | Start with user-initiated + agent can suggest via chat message (not auto-create) |
| **Migration**: Existing portfolios have no change history. The first snapshot becomes the baseline — no retroactive history reconstruction. | Low | Acceptable — document this in onboarding |

## Review Workload Forecast

- Estimated changed lines: ~900-1200
- Chained PRs recommended: Yes
- 400-line budget risk: High
- Decision needed before apply: Yes — PR split strategy (suggested: PR1 = schema + backend audit log + snapshot CRUD; PR2 = agent tool + REST endpoints; PR3 = frontend UI)
