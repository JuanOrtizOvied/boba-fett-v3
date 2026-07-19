# Portfolio Versioning: Automatic Change Log

## Requirements

### AL-001: Change Log Entry on Product Create
**Priority**: Must
**Description**: Every successful `ProductRepository.create` call MUST insert a corresponding row into `portfolio_changes` with `operation = 'create'`, `before_state = NULL`, and `after_state` set to the full serialized `Product` that was just created.

#### Scenarios

**Scenario: Agent adds a product**
- Given: an authenticated user with an empty portfolio
- When: the `add_product` tool successfully creates a new product
- Then: a `portfolio_changes` row is inserted with `operation = 'create'`, `product_id` matching the new product's id, `before_state = NULL`, `after_state` containing the full product payload, and `source = 'agent'`

**Scenario: Manual REST creation**
- Given: an authenticated user
- When: they call `POST /portfolio/me/products` and the product is created
- Then: a `portfolio_changes` row is inserted with `source = 'api'`

### AL-002: Change Log Entry on Product Update
**Priority**: Must
**Description**: Every successful `ProductRepository.update` call MUST insert a `portfolio_changes` row with `operation = 'update'`, `before_state` set to the product's full state prior to the update, and `after_state` set to the full state after the update.

#### Scenarios

**Scenario: Amount change is logged with full before/after state**
- Given: a product "BlackRock Private Credit Fund" with `amount = 150000`
- When: the amount is updated to `175000` via `update_product` or `PATCH /products/:id`
- Then: a `portfolio_changes` row is inserted with `operation = 'update'`, `before_state.amount = 150000`, and `after_state.amount = 175000`

**Scenario: Partial update only overwrites changed fields in after_state**
- Given: a product with `category = "Mercados Privados"` and `provider = "SABBI"`
- When: only `category` is updated to `"Club Deals"`
- Then: `after_state.provider` remains `"SABBI"` and `after_state.category = "Club Deals"`, reflecting the full row post-update, not just the changed field

**Scenario: No-op update (product not found) does not log**
- Given: a `product_id` that does not exist
- When: `update_product` or `PATCH /products/:id` is called for that id
- Then: no `portfolio_changes` row is inserted and the caller receives the existing not-found error (`{"status": "error", ...}` for the tool, `404` for the REST route)

### AL-003: Change Log Entry on Product Delete
**Priority**: Must
**Description**: Every successful `ProductRepository.delete` call MUST insert a `portfolio_changes` row with `operation = 'delete'`, `before_state` set to the product's full state prior to deletion, and `after_state = NULL`.

#### Scenarios

**Scenario: Product deletion is logged with prior state**
- Given: a product "Edifica Fund III" with `amount = 125000`
- When: the product is deleted via `delete_product` or `DELETE /products/:id`
- Then: a `portfolio_changes` row is inserted with `operation = 'delete'`, `before_state` containing the full pre-deletion product payload, and `after_state = NULL`

**Scenario: Deleting a non-existent product does not log**
- Given: a `product_id` that does not exist or was already deleted
- When: `delete_product` or `DELETE /products/:id` is called for that id
- Then: no `portfolio_changes` row is inserted and the caller receives the existing not-found error (`404` for the REST route)

### AL-004: Change Log Atomicity
**Priority**: Must
**Description**: The product mutation and its corresponding `portfolio_changes` insert MUST execute inside a single Postgres transaction. If the change log insert fails, the product mutation MUST be rolled back — the system must never persist a mutation without its audit entry.

#### Scenarios

**Scenario: Change log insert failure rolls back the mutation**
- Given: a `portfolio_changes` insert that fails (e.g. a constraint violation)
- When: `ProductRepository.create`, `.update`, or `.delete` is called
- Then: the product table mutation is rolled back — the product is not created/updated/deleted — and the caller receives a 500-level error

**Scenario: Successful mutation and log insert commit together**
- Given: a valid product mutation
- When: the transaction commits
- Then: both the `products` row and the `portfolio_changes` row are visible to subsequent reads in the same commit

### AL-005: Change Log Source Attribution
**Priority**: Must
**Description**: Every `portfolio_changes` row MUST record a `source` value of `'agent'`, `'api'`, or `'admin'`, identifying whether the mutation originated from an agent tool call, a direct REST API call from the portfolio panel, or an admin action. `ProductRepository.create`/`.update`/`.delete` MUST accept an optional `source` parameter (default `'api'`) that callers pass through.

#### Scenarios

**Scenario: Agent tool call is attributed to "agent"**
- Given: the LangGraph agent calls `add_product`, `update_product`, or `delete_product`
- When: the repository method executes
- Then: the resulting `portfolio_changes.source = 'agent'`

**Scenario: Portfolio panel manual edit is attributed to "api"**
- Given: an investor edits a product directly from the portfolio panel UI (no LLM call)
- When: the frontend calls `PATCH /products/:id` or `DELETE /products/:id`
- Then: the resulting `portfolio_changes.source = 'api'`

**Scenario: Metadata captures the originating tool or thread**
- Given: an agent tool call that creates a product
- When: the `portfolio_changes` row is inserted
- Then: `metadata` includes at minimum the tool name (e.g. `"tool": "add_product"`); it MAY include `thread_id` when available from `RunnableConfig`

### AL-006: Paginated Change Log Retrieval
**Priority**: Must
**Description**: `GET /portfolio/me/changes` MUST return a paginated list of the authenticated user's `portfolio_changes` entries, ordered by `created_at` descending, with `limit` and `offset` (or cursor) query parameters.

#### Scenarios

**Scenario: Default page size**
- Given: a user with 150 change log entries
- When: they call `GET /portfolio/me/changes` with no query parameters
- Then: the response returns the most recent entries up to a default page size (e.g. 50) and includes pagination metadata (`total`, `has_more` or equivalent)

**Scenario: Explicit pagination**
- Given: a user with 150 change log entries
- When: they call `GET /portfolio/me/changes?limit=20&offset=40`
- Then: the response returns entries 41-60 ordered by `created_at` descending

**Scenario: Empty change log**
- Given: a newly created user with no portfolio mutations yet
- When: they call `GET /portfolio/me/changes`
- Then: the response returns an empty list with `200` status, not an error

**Scenario: Filter by operation type**
- Given: a user's change log contains creates, updates, and deletes
- When: they call `GET /portfolio/me/changes?operation=delete`
- Then: only entries with `operation = 'delete'` are returned

### AL-007: Change Log Ownership Enforcement
**Priority**: Must
**Description**: `GET /portfolio/me/changes` MUST only return the authenticated user's own change log entries. Admins reading another user's change history MUST use a separate admin-scoped read path and MUST NOT be able to mutate or delete change log entries for any user (`access-control/spec.md` — "Ownership Enforcement").

#### Scenarios

**Scenario: User sees only their own changes**
- Given: user A and user B each have change log entries
- When: user A calls `GET /portfolio/me/changes`
- Then: only user A's entries are returned

**Scenario: Admin views a client's change history read-only**
- Given: an authenticated admin and a client user with change log entries
- When: the admin requests that client's change history via an admin-scoped route
- Then: the entries are returned, but no endpoint permits the admin to modify or delete any `portfolio_changes` row

**Scenario: Unauthenticated request denied**
- Given: no valid access token
- When: `GET /portfolio/me/changes` is called
- Then: the system responds `401`

### AL-008: Change Log Visibility in Portfolio Panel
**Priority**: Should
**Description**: The portfolio panel MUST expose a way to view recent change log activity (e.g. a recent-activity indicator or expandable history section) without navigating away from the dashboard.

#### Scenarios

**Scenario: Recent activity indicator shows latest mutation**
- Given: the investor's portfolio was just modified by the agent
- When: the portfolio panel refetches after the chat stream completes
- Then: a recent-activity indicator reflects the latest change (e.g. "1 product added just now")

**Scenario: Expandable history shows a chronological list**
- Given: the investor opens the change history section
- When: it renders
- Then: entries are displayed in reverse-chronological order with operation type, product name (from `before_state`/`after_state`), source, and a human-readable timestamp
