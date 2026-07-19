# Portfolio Versioning: Named Snapshots

## Requirements

### SNAP-001: Create Named Snapshot
**Priority**: Must
**Description**: `POST /portfolio/me/snapshots` MUST create an immutable, named point-in-time copy of the authenticated user's current portfolio. The request body MUST require a non-empty `name` and MAY include a `description`.

#### Scenarios

**Scenario: Investor creates a snapshot with a name**
- Given: an authenticated investor with 8 products in their portfolio
- When: they call `POST /portfolio/me/snapshots` with `{"name": "Pre-meeting Q3"}`
- Then: the response is `201` with the created snapshot's `id`, `name`, `product_count = 8`, `total_amount` matching the portfolio total, and `created_at`

**Scenario: Snapshot creation rejects an empty name**
- Given: an authenticated investor
- When: they call `POST /portfolio/me/snapshots` with `{"name": ""}` or omit `name`
- Then: the system responds `422` and no `portfolio_snapshots` row is created

**Scenario: Description is optional**
- Given: an authenticated investor
- When: they call `POST /portfolio/me/snapshots` with only `{"name": "Baseline"}`
- Then: the snapshot is created with `description = ""`

### SNAP-002: Snapshot Materializes Full Product State
**Priority**: Must
**Description**: Creating a snapshot MUST persist a full, denormalized copy of every product in the user's portfolio at that instant into `snapshot_products` (one row per product, `product_data` containing the complete serialized `Product`). The snapshot MUST NOT reference live `products` rows by foreign key for its content — later edits or deletes on live products MUST NOT alter a previously created snapshot.

#### Scenarios

**Scenario: Snapshot captures every product's full field set**
- Given: a portfolio with a product that has `composition`, `asset_class`, `commission`, and other enrichment fields populated
- When: a snapshot is created
- Then: the corresponding `snapshot_products.product_data` row contains all of those fields, not just id/name/amount

**Scenario: Later product edits do not affect an existing snapshot**
- Given: a snapshot "Q2 Review" was created when a product had `amount = 100000`
- When: the live product is later updated to `amount = 120000`
- Then: `GET /portfolio/me/snapshots/:id` for "Q2 Review" still returns `amount = 100000` for that product

**Scenario: Later product deletion does not affect an existing snapshot**
- Given: a snapshot "Q2 Review" includes product "prod_abc123"
- When: "prod_abc123" is later deleted from the live portfolio
- Then: `GET /portfolio/me/snapshots/:id` for "Q2 Review" still includes "prod_abc123" with its captured state

### SNAP-003: List Snapshots
**Priority**: Must
**Description**: `GET /portfolio/me/snapshots` MUST return all of the authenticated user's snapshots, ordered by `created_at` descending, including `id`, `name`, `description`, `product_count`, `total_amount`, and `created_at` for each — without the full `snapshot_products` payload (summary view only).

#### Scenarios

**Scenario: List returns snapshots newest first**
- Given: a user created snapshots "A" then "B" then "C"
- When: they call `GET /portfolio/me/snapshots`
- Then: the response lists "C", "B", "A" in that order

**Scenario: Empty snapshot list for a new user**
- Given: a user who has never created a snapshot
- When: they call `GET /portfolio/me/snapshots`
- Then: the response is `200` with an empty list

### SNAP-004: Get Snapshot Detail
**Priority**: Must
**Description**: `GET /portfolio/me/snapshots/:id` MUST return the full snapshot including its materialized product list.

#### Scenarios

**Scenario: Detail view returns full product list**
- Given: a snapshot with 12 materialized products
- When: the owner calls `GET /portfolio/me/snapshots/:id`
- Then: the response includes all 12 products' full data plus the snapshot's `name`, `description`, `product_count`, `total_amount`, and `created_at`

**Scenario: Snapshot not found**
- Given: a snapshot id that does not exist
- When: `GET /portfolio/me/snapshots/:id` is called
- Then: the system responds `404`

### SNAP-005: Snapshot Immutability
**Priority**: Must
**Description**: Once created, a snapshot's `name`, `description`, `product_count`, `total_amount`, and materialized `snapshot_products` rows MUST NOT be mutable through any API route. No `PATCH` or `PUT` route for snapshots is exposed. Deletion of a snapshot (if supported by the UI) is out of scope for this change unless explicitly implemented as a distinct, separately-gated action.

#### Scenarios

**Scenario: No update route exists for snapshots**
- Given: an existing snapshot
- When: a `PATCH /portfolio/me/snapshots/:id` request is attempted
- Then: the system responds `404` or `405` (route not implemented) — snapshots cannot be edited after creation

**Scenario: Snapshot content is stable across repeated reads**
- Given: a snapshot created at time T
- When: `GET /portfolio/me/snapshots/:id` is called at time T and again at T+7 days, with intervening unrelated portfolio mutations
- Then: both responses return byte-identical `snapshot_products` content

### SNAP-006: Agent-Initiated Snapshot Creation Tool
**Priority**: Must
**Description**: A new agent tool `create_snapshot(name: str, description: str = "")` MUST be available to the LLM, bound the same way as `add_product`/`update_product`/`delete_product`, and MUST create a snapshot for the calling user (resolved via `RunnableConfig["configurable"]["user_id"]`, same pattern as other portfolio tools). Snapshots created via this tool MUST be user-initiated (the agent proposes it in chat and the user confirms, or the user explicitly asks) — the agent MUST NOT silently auto-create snapshots without the user requesting or confirming one.

#### Scenarios

**Scenario: Agent creates a snapshot on explicit user request**
- Given: an investor in an active chat says "save this as a version called Pre-Meeting"
- When: the agent calls `create_snapshot(name="Pre-Meeting")`
- Then: a snapshot is created for that user's current portfolio state and the tool returns `{"status": "created", "snapshot": {...}}`

**Scenario: Agent suggests a snapshot without auto-creating it**
- Given: the agent just finished processing a document upload that added 5 products
- When: the agent responds to the user
- Then: the agent MAY suggest creating a snapshot via a chat message, but MUST NOT call `create_snapshot` unless the user confirms

**Scenario: Snapshot tool call is attributed to the agent**
- Given: `create_snapshot` is called by the agent
- When: the snapshot is created
- Then: it is indistinguishable in ownership from a REST-created snapshot (same `user_id`), and any resulting audit trail (if snapshot creation also logs to `portfolio_changes`) records `source = 'agent'`

### SNAP-007: Snapshot Creation UI
**Priority**: Must
**Description**: The portfolio panel header MUST expose a snapshot creation affordance — a button that opens a name-input popover and calls `POST /portfolio/me/snapshots` on submit.

#### Scenarios

**Scenario: Investor creates a snapshot from the UI**
- Given: the investor is viewing the portfolio panel
- When: they click "Save version", enter a name, and confirm
- Then: `POST /portfolio/me/snapshots` is called with that name, and on success the popover closes with a confirmation

**Scenario: Empty name is blocked client-side**
- Given: the snapshot name popover is open
- When: the investor clicks confirm with an empty name field
- Then: the request is not sent and an inline validation message is shown

### SNAP-008: Snapshot Timeline / History View
**Priority**: Must
**Description**: The frontend MUST provide a timeline/list view (slide-over or modal) of all snapshots for the authenticated user, allowing them to jump to any historical snapshot in a read-only detail view. This is navigation only — it MUST NOT mutate the live portfolio.

#### Scenarios

**Scenario: Investor browses the snapshot timeline**
- Given: the investor has 5 snapshots
- When: they open the snapshot timeline panel
- Then: all 5 snapshots are listed with name, date, and product count, newest first

**Scenario: Selecting a snapshot opens a read-only view**
- Given: the snapshot timeline is open
- When: the investor selects a snapshot
- Then: a read-only detail view renders that snapshot's materialized products; no edit or delete controls are shown, and the live portfolio is unaffected

### SNAP-009: Empty Portfolio Snapshot
**Priority**: Should
**Description**: Creating a snapshot of an empty portfolio (zero products) MUST succeed and produce a valid snapshot with `product_count = 0` and `total_amount = 0`, not an error.

#### Scenarios

**Scenario: Snapshot of a brand-new empty portfolio**
- Given: a newly registered user with no products
- When: they call `POST /portfolio/me/snapshots` with `{"name": "Starting point"}`
- Then: the response is `201` with `product_count = 0`, `total_amount = 0`, and zero `snapshot_products` rows

### SNAP-010: Snapshot Ownership Enforcement
**Priority**: Must
**Description**: Snapshot routes MUST enforce that only the owning user can create, list, or view their snapshots. Admins MAY view (read-only) another user's snapshots via a separate admin-scoped path but MUST NOT create, modify, or delete snapshots on behalf of another user (`access-control/spec.md` — "Ownership Enforcement").

#### Scenarios

**Scenario: Non-owner denied snapshot detail access**
- Given: a snapshot owned by user A
- When: user B (role "user") requests `GET /portfolio/me/snapshots/:id` for that snapshot's id
- Then: the system responds `403` or `404` (not disclosing existence to a non-owner) — user B's own `/portfolio/me/snapshots/:id` scope never resolves to user A's snapshot

**Scenario: Admin views a client's snapshots read-only**
- Given: an authenticated admin and a client user with existing snapshots
- When: the admin requests the client's snapshots via an admin-scoped route
- Then: the snapshots are returned, but no route allows the admin to call `POST` snapshots on behalf of that client

### SNAP-011: Snapshot Creation Consistency Under Concurrent Mutation
**Priority**: Should
**Description**: Snapshot creation MUST capture a consistent view of all products — if a concurrent mutation (create/update/delete) is in flight for the same user during snapshot creation, the snapshot MUST reflect either the pre- or post-mutation state entirely, never a partial mix (e.g. some products reflecting old values, others new, or a product missing because it was read mid-insert).

#### Scenarios

**Scenario: Snapshot creation is isolated from a concurrent product create**
- Given: a snapshot creation request and a concurrent `add_product` call for the same user, submitted at nearly the same time
- When: both complete
- Then: the snapshot either fully includes the new product (if the create committed first) or fully excludes it (if the snapshot's read committed first) — never a state where `product_count` is inconsistent with the materialized rows

**Scenario: Snapshot creation is isolated from a concurrent product delete**
- Given: a snapshot creation request and a concurrent `delete_product` call for the same product owned by the same user
- When: both complete
- Then: the snapshot either fully includes or fully excludes the deleted product, consistent with its own `product_count`
