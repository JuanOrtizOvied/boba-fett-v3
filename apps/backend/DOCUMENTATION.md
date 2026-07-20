# SABBI Backend — Documentation

## Overview

SABBI (Sistema Asistido de Building de Inversiones) is an AI-assisted investment portfolio builder. The backend is a **dual-service Python application** that runs two independent ASGI servers sharing a single PostgreSQL database:

| Service | Framework | Dev Port | Purpose |
|---------|-----------|----------|---------|
| **LangGraph Agent** | LangGraph + LangChain + Anthropic Claude | `:2024` | Conversational AI that identifies, classifies, and manages investment products via chat |
| **FastAPI REST API** | FastAPI + asyncpg | `:3003` | Direct CRUD for the portfolio panel UI — no LLM call involved |

Both services write to the same `products` table via `db.repository.ProductRepository` and share the same process-wide `asyncpg.Pool` managed by `db.connection.get_pool()`.

### Tech Stack

- **Python** >= 3.11
- **LangGraph** >= 0.4 (graph orchestration)
- **LangChain Core** >= 0.3 + **langchain-anthropic** >= 0.3
- **langgraph-checkpoint-postgres** >= 3.0 + **psycopg[binary,pool]** >= 3.3 (Postgres-backed checkpointer/store for the FastAPI chat graph)
- **Anthropic Claude** (`claude-sonnet-5` for the agent, `claude-haiku-4-5` for structured extraction)
- **FastAPI** >= 0.115 (REST API)
- **asyncpg** >= 0.29 (PostgreSQL async driver)
- **PostgreSQL** >= 14 (with `pgcrypto` and `pg_trgm` extensions)
- **openpyxl** >= 3.1 (server-side Excel export)
- **bcrypt** >= 4.1 (password hashing)
- **PyJWT** >= 2.8 (JWT token management)
- **tavily-python** >= 0.5 (web search fallback for product lookup)

### Directory Structure

```
apps/backend/
├── langgraph.json              # LangGraph server config (graph ID "agent")
├── package.json                # Yarn workspace scripts (dev, lint, test)
├── pyproject.toml               # Python project metadata and dependencies
├── requirements.txt            # Runtime pip requirements mirror (pyproject.toml is source of truth)
├── src/
│   ├── agent/                  # LangGraph conversational agent
│   │   ├── __init__.py
│   │   ├── file_utils.py       # Parses non-PDF/image attachments (Excel, CSV, Word) into text
│   │   ├── graph.py            # Graph definition and compilation
│   │   ├── nodes.py            # Node functions (router, process_document, agent)
│   │   ├── prompts.py          # System prompt (Spanish, investment-focused)
│   │   ├── search.py           # Cascading L1→L2→L3 product search
│   │   ├── state.py            # AgentState schema + CATEGORIES taxonomy
│   │   └── tools.py            # Portfolio tools (search, propose, add, update, delete, summary, snapshot)
│   ├── api/                    # FastAPI REST API
│   │   ├── __init__.py         # Re-exports `app` from routes.py
│   │   ├── routes.py           # Portfolio CRUD + versioning + Excel export + app lifespan
│   │   ├── auth_routes.py      # Login, logout, refresh, me, thread management
│   │   ├── chat_routes.py      # Chat SSE streaming + thread state
│   │   └── admin_routes.py     # Admin-only user/portfolio/catalog/thread management
│   ├── auth/                   # Authentication module
│   │   ├── __init__.py
│   │   ├── dependencies.py     # FastAPI deps: get_current_user, require_admin
│   │   ├── models.py           # Pydantic request/response models
│   │   ├── passwords.py        # bcrypt hash/verify
│   │   ├── repository.py       # UserRepository (users + refresh_tokens tables)
│   │   ├── seed.py             # Idempotent admin bootstrap
│   │   └── tokens.py           # JWT access/refresh token creation and validation
│   └── db/                     # Database layer
│       ├── __init__.py
│       ├── catalog_repository.py  # CatalogRepository (pg_trgm similarity search + admin approval CRUD)
│       ├── connection.py       # Singleton asyncpg pool + schema auto-apply
│       ├── excel.py            # Server-side .xlsx workbook generation
│       ├── models.py           # Pydantic domain models (Product, SearchResult, Snapshot, etc.)
│       ├── repository.py       # ProductRepository (products table CRUD + change-log audit)
│       ├── schema.sql          # DDL for all tables, indexes, extensions
│       ├── seed_catalog.py     # CLI to populate product_catalog from Excel
│       └── versioning.py       # VersioningRepository (snapshots, comparison, change log)
└── tests/                      # pytest test suite
    ├── conftest.py
    ├── integration/            # Tests requiring a real Postgres instance
    └── test_*.py               # Unit tests (mocked DB)
```

---

## LangGraph Agent

### Graph Structure

**File:** `src/agent/graph.py`

The agent is registered as graph ID `"agent"` in `langgraph.json` at the path `./src/agent/graph.py:graph`.

```
START → router → (process_document | agent) → agent → (tools | END)
                                                         ↓
                                                      tools → agent  (loop)
```

**Nodes:**

| Node | Function | Purpose |
|------|----------|---------|
| `router` | `router_node` | Pass-through entry point; routing is decided by `has_file_attachment` on the conditional edge. Exists so the routing step is visible in LangGraph traces. |
| `process_document` | `process_document_node` | Injects an extraction `SystemMessage` so the agent processes an attached PDF/image with Claude vision and persists products via `add_product`. |
| `agent` | `agent_node` | Main conversational node — invokes Claude with portfolio tools bound. |
| `tools` | `ToolNode(portfolio_tools)` | Standard LangGraph `ToolNode` — tools write to Postgres directly, no custom executor. |

**Edges:**

| From | To | Condition |
|------|----|-----------|
| `START` | `router` | Always |
| `router` | `process_document` or `agent` | `has_file_attachment(state)` — checks if the last message contains a file/image content block |
| `process_document` | `agent` | Always (after injecting extraction prompt) |
| `agent` | `tools` or `END` | `should_continue(state)` — routes to `tools` if the last AI message has pending `tool_calls`, otherwise ends |
| `tools` | `agent` | Always (loop back after tool execution) |

**Compilation:**

```python
graph = builder.compile()
```

In the FastAPI lifespan (`api/routes.py`), the graph is re-compiled with a Postgres-backed checkpointer and store when `POSTGRES_URI` is set:

```python
app.state.chat_graph = graph_builder.compile(checkpointer=checkpointer, store=store)
```

### Agent State Schema

**File:** `src/agent/state.py`

```python
class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
```

Portfolio data does NOT live in `AgentState`. It is persisted in PostgreSQL via `ProductRepository` so it survives across chat threads, page reloads, and LangGraph checkpoint resets. The graph state only carries the conversation messages.

### Category Taxonomy

**File:** `src/agent/state.py` — `CATEGORIES`

A 3-level hierarchy shared across the system prompt, tool validation, cascade search classifier, and Excel export:

| Category Key | Label | Subcategory Groups |
|-------------|-------|-------------------|
| `inversiones_directas` | Inversiones directas | RE Perú (Residencial, Oficinas, Comercial/Industrial), RE Extranjero |
| `mercados_privados` | Mercados privados | Deuda Privada, Private Equity, Venture Capital, Real Estate, Hedge Funds, Infraestructura |
| `club_deals` | Club deals | Real Estate (Perú, Extranjero), Deuda Privada (Perú, Extranjero), Otros (Perú, Extranjero) |
| `mercados_publicos` | Mercados públicos | Renta Variable (US Large Cap, US Mid & Small Cap, Developed ex-US, EM ex-Perú, Perú), Renta Fija (US Treasuries, IG Corporates AAA-BBB, High Yield BB-, EM Bonds, LatAm Bonds, Perú Bonds) |
| `otros` | Otros | Cripto (Bitcoin, Ethereum, Otras), Commodities (Oro) |
| `cash_y_equivalentes` | Cash y equivalentes | Cash (Depósitos a plazo, Fondos de Money Market) |

Category keys were renamed from an earlier short-key scheme (`directas`, `privados`, `club`, `publicos`, `cash` — `otros` stayed the same). Legacy short keys and Spanish labels are still accepted at the edges of the system and normalized to the canonical key:

- **`agent/tools.py`** — `_normalize_category_key()` resolves any key or label (canonical or legacy) to its canonical form via `_LABEL_TO_KEY` (merged with a `_LEGACY_ALIASES` map), falling back to `"otros"` for unrecognized values. Every tool that accepts a `category` argument (`propose_product`, `add_product`, `update_product`) normalizes it before use.
- **`agent/search.py`** — `_LEGACY_CATEGORY_LABELS` and `_is_valid_category()` accept the old short keys/labels so `_sanitize_taxonomy()` doesn't wipe a still-recognizable legacy value returned by the catalog or web search.
- **`db/schema.sql`** — one-time `UPDATE` statements normalize any pre-existing `products.category` / `product_catalog.category` rows from the old keys/labels to the new canonical keys.

### Model Configuration

**File:** `src/agent/nodes.py`

```python
MODEL_NAME = "claude-sonnet-5"

llm = ChatAnthropic(
    model=MODEL_NAME,
    max_tokens=16000,
    thinking={"type": "adaptive"},
)
llm_with_tools = llm.bind_tools(portfolio_tools)
```

- **Main agent model:** `claude-sonnet-5` with adaptive thinking enabled
- **Max tokens:** 16,000
- **Extraction model** (for cascade search): `claude-haiku-4-5` (cheap, fast structured extraction — see `src/agent/search.py`)
- The LLM is Anthropic-only and hardcoded — there is no configurable-provider indirection

### System Prompt

**File:** `src/agent/prompts.py`

The system prompt is written entirely in Spanish (product requirement — SABBI serves Spanish-speaking investors). Key rules enforced:

1. **Search-first workflow:** When the user mentions a product, ALWAYS call `search_product` first to investigate it via the cascade search. If nothing is found, retry with alternative terms (translations, tickers, common names).
2. **Never reveal internals:** Never mention the catalog, cascade search levels, or data provenance to the user in chat text — that information is for the UI's `provenance` badges only.
3. **No fabrication:** NEVER invent or assume a value for a field `search_product` left empty (commission, currency, administrator, manager, liquidity, return_rate, etc.) — an empty field is preferable to an invented one.
4. **Propose-before-add:** After identifying a product, ALWAYS call `propose_product`, forwarding the enrichment fields and `primary_source`/`provenance` from `search_product` unmodified. The UI renders an interactive card with editable fields, source badges, and Yes/No buttons. Only after the user confirms does the agent call `add_product` with the (possibly user-edited) data. NEVER call `add_product` directly without a prior confirmation, and NEVER present a product as plain text asking for verbal confirmation — the card is always the confirmation mechanism.
5. **Forward enrichment fields to `add_product`:** All enrichment fields returned by `search_product` (`asset_class`, `currency`, `commission`, `administrator`, `manager`, `liquidity`, `return_rate`, `geographic_focus`) must be forwarded to `add_product` unchanged — they're persisted on the product and feed the catalog-approval flow.
6. **Auto-classification:** If `search_product` returned `category` with confidence, use it directly. If it left `category` empty, call `propose_product` anyway with `category` empty rather than guessing — the confirmation card highlights the missing field for the user to fill in the UI. NEVER ask for the category as plain text.
7. **`underlying` allocation rules:** `underlying` is a list of `{"name": "<subcategory leaf>", "percentage": <number>}` objects describing how the investment splits across the taxonomy's canonical subcategory leaves for the chosen category. Percentages must sum to exactly 100%. When omitted, 100% is assumed to be allocated to the product's own name.
8. **Card presentation:** After calling `propose_product`, do not add explanatory text before/after the card — let the card speak for itself. A short message before a batch of proposals (e.g. "Encontré estos productos en tu documento:") is fine; nothing after.
9. **Response format:** Always respond in Spanish, professional/friendly tone, never mention tool/function names to the user, and confirm every add/update/delete action.

The prompt is dynamically constructed with `_format_categories()` which renders the full 3-level taxonomy from `CATEGORIES`.

### Tool Definitions

**File:** `src/agent/tools.py`

All tools persist directly to PostgreSQL via `ProductRepository` (and, for `create_snapshot`, `VersioningRepository`). The `user_id` is supplied per-run via `RunnableConfig["configurable"]["user_id"]`. In the current FastAPI chat flow, `api/chat_routes.py` resolves the authenticated user from the `sabbi_access` cookie and injects that `user_id` into the graph config before streaming.

#### `search_product(query: str) -> dict`

Searches for an investment product via the three-level cascade (L1 catalog → L2 Claude knowledge → L3 Tavily web search). Returns enrichment fields and provenance metadata.

- **Parameters:** `query` — product name, ticker, or description
- **Returns:** `{"status": "found"|"not_found", "query": str, "result": SearchResult}` or `{"status": "not_found", "query": str}`

#### `propose_product(name, amount, category, ...) -> dict`

Proposes adding a product and asks the user to confirm via a UI card with Yes/No buttons. Must be called INSTEAD of `add_product` when a product is first identified.

- **Parameters:**
  - `name: str` — product name
  - `amount: float` — investment amount in USD
  - `category: str` — one of: inversiones_directas, mercados_privados, club_deals, mercados_publicos, otros, cash_y_equivalentes
  - `provider: str = ""` — provider/fund manager
  - `underlying: list[dict] | None` — subcategory allocations `[{name, percentage}]`; names must be canonical taxonomy leaves and percentages must sum to 100. Defaults to `[{name: product_name, percentage: 100}]` when omitted.
  - `asset_class, currency, commission, administrator, manager, liquidity, return_rate, geographic_focus: str` — enrichment fields from `search_product`
  - `catalog_product_id: int | None` — source `product_catalog.id` when `search_product` found the product in the SABBI catalog; forwarded unchanged so admin catalog approval can later replace that row
  - `primary_source: FieldSource` — weakest data source across all fields
  - `provenance: dict[str, FieldSource] | None` — per-field source map
- **Returns:** `{"status": "proposed", "product": {..., "reliability_tag": "verified"|"web"|"unverified"}}`
- **Reliability tag derivation** (`_derive_card_tag`):
  - No provenance data at all → `"unverified"`
  - `name` field sourced from `catalog` → `"verified"`
  - Otherwise, any field sourced from `web_search` → `"web"`
  - Otherwise (only `claude_knowledge`, or `name` not from `catalog` and no `web_search`) → `"unverified"`

#### `add_product(name, amount, category, ...) -> dict`

Adds a new investment product to the user's portfolio in PostgreSQL.

- **Parameters:**
  - `name: str`, `amount: float`, `category: str`, `provider: str = ""`
  - `underlying: list[dict] | None` — same shape/validation as `propose_product`; defaults to `[{name: product_name, percentage: 100}]`
  - `asset_class, currency, commission, administrator, manager, liquidity, return_rate, geographic_focus: str` — enrichment fields, persisted on the product row
  - `catalog_product_id: int | None` — forwarded from `search_product`/`propose_product` when the product came from the catalog
- **Returns:** `{"status": "added", "product": Product}`
- **Requires:** `user_id` from `RunnableConfig["configurable"]`
- Persisted via `ProductRepository.create(..., source="agent", metadata={"tool": "add_product"})`, which also inserts a `portfolio_changes` audit row in the same transaction (see Repository Pattern below).

#### `update_product(product_id, ...) -> dict`

Updates an existing product.

- **Parameters:** `product_id: str`, plus optional `name`, `provider`, `amount`, `category`, `underlying`
- **Returns:** `{"status": "updated"|"error", ...}`
- Persisted via `ProductRepository.update(..., source="agent", metadata={"tool": "update_product"})`, logging a `portfolio_changes` audit row with the before/after product state.

#### `delete_product(product_id) -> dict`

Removes a product from the portfolio.

- **Parameters:** `product_id: str`
- **Returns:** `{"status": "deleted"|"error", ...}`
- Persisted via `ProductRepository.delete(..., source="agent", metadata={"tool": "delete_product"})`, logging a `portfolio_changes` audit row with the deleted product's prior state.

#### `get_portfolio_summary() -> dict`

Returns portfolio overview: totals, category distribution, and largest position.

- **Requires:** `user_id` from `RunnableConfig["configurable"]`
- **Returns:** `{"total_amount", "product_count", "categories_used", "distribution", "largest_position"}`

#### `create_snapshot(name, description="") -> dict`

Saves the current portfolio as a named, immutable snapshot. Only called on the user's explicit request or after they confirm a suggestion — the agent must not create a snapshot on its own initiative.

- **Parameters:** `name: str` — short descriptive name; `description: str = ""` — optional longer description
- **Returns:** `{"status": "created", "snapshot": {...}}` or `{"status": "error", "message": str}` (e.g. when the portfolio is unchanged since the latest snapshot — `VersioningRepository.create_snapshot` raises `SnapshotUnchangedError` in that case)
- **Requires:** `user_id` from `RunnableConfig["configurable"]`

### Document Processing

**File:** `src/agent/nodes.py`

When a user uploads a file (PDF, image, spreadsheet, Word document), the `router` node detects the attachment via `has_file_attachment()` and routes to `process_document_node`.

**Attachment detection** (`_has_attachment`): checks if any content block in the last message has `type` in `("image_url", "image", "document", "file")`.

**Non-PDF/image attachment parsing** (`src/agent/file_utils.py`): Claude's native `document` content type only accepts `application/pdf`. `_normalize_file_blocks()` (in `nodes.py`) routes any other attached file type through `agent.file_utils.file_to_text()`:
- Spreadsheets (`.xlsx`, `.xls`, `.csv`) are parsed sheet-by-sheet into a pipe-delimited text block via `openpyxl`.
- Word documents (`.docx`) are unzipped and their `word/document.xml` paragraphs are extracted into plain text (`.doc` is explicitly unsupported — returns a placeholder message).
- Unsupported/unparseable formats fall back to a `[Archivo adjunto]` placeholder text block rather than failing the request.

**Extraction prompt** (`EXTRACTION_PROMPT`): instructs Claude to analyze the attached document, extract ALL investment products (name, provider, amount, category, underlying), present them in a clear list, and use `add_product` for each one. This is a deliberate document-ingestion exception to the normal chat flow, where the agent should propose products before adding them.

The extraction prompt is injected as a `SystemMessage` (not a `HumanMessage`) so it does not render as a user bubble in the chat UI.

### Message Normalization

**File:** `src/agent/nodes.py`

Several helper functions ensure robustness across checkpoint restores and multi-turn conversations:

| Function | Purpose |
|----------|---------|
| `_strip_thinking(msg)` | Removes `thinking` blocks from previous AI messages so they do not get re-sent to the API (checkpoints often drop the inner thinking text, causing 400 errors) |
| `_normalize_file_blocks(msg)` | Converts `{type: "file"}` content blocks from older sessions to Anthropic's expected `document`/`image`/`text` format, parsing non-PDF/image files to text via `agent.file_utils` |
| `_patch_orphan_tool_calls(conversation)` | Ensures every `tool_use` block has a matching `ToolMessage` result — orphaned tool calls from interrupted runs get a synthetic `"[interrupted — no result available]"` response to prevent API 400 errors |

### Streaming

**File:** `src/api/chat_routes.py`

The chat endpoint (`POST /chat/threads/{thread_id}/messages/stream`) streams Server-Sent Events (SSE) with these event types:

| SSE Event | Data | When |
|-----------|------|------|
| `progress` | `{step, label}` | Node/tool transitions (e.g., "Analizando solicitud", "Procesando documento", "Consultando al modelo", "Ejecutando herramientas", "Ejecutando: add_product") |
| `reasoning` | `{content}` | Thinking/reasoning content from Claude's adaptive thinking blocks |
| `text` | `{content}` | Token-by-token text streaming from the agent response |
| `final` | `ThreadStateResponse` | Complete thread state with all messages after the run finishes |
| `error` | `{detail}` | Error message if streaming fails |
| `done` | `"[DONE]"` | Signals stream completion |

---

## FastAPI REST API

**File:** `src/api/routes.py`

The FastAPI app is instantiated as:

```python
app = FastAPI(title="SABBI Portfolio API", lifespan=lifespan)
```

### Lifespan

On startup (`lifespan`):
1. Creates the process-wide `asyncpg.Pool` via `get_pool()` (which also runs `schema.sql` and seeds the admin user)
2. Attaches `ProductRepository`, `VersioningRepository`, `UserRepository`, and `CatalogRepository` to `app.state`
3. Initializes the Postgres-backed chat graph if `POSTGRES_URI` is set (`_init_chat_graph`)

On shutdown:
- Closes the connection pool via `close_pool()`

### Routers

The app includes three sub-routers:

| Router | Prefix | Auth | File |
|--------|--------|------|------|
| `auth_router` | `/auth` | Mixed (login is public, others need `sabbi_access`) | `auth_routes.py` |
| `admin_router` | `/admin` | `require_admin` on all routes | `admin_routes.py` |
| `chat_router` | `/chat` | `get_current_user` on all routes | `chat_routes.py` |

Portfolio routes (including versioning) are defined directly on the main `app` (no prefix).

### Portfolio Endpoints

All portfolio endpoints require `get_current_user` (valid `sabbi_access` cookie).

#### `GET /portfolio/me`

List all products for the authenticated user.

- **Auth:** `get_current_user`
- **Response:** `{"products": [Product]}`

#### `POST /portfolio/me/products`

Create a new product.

- **Auth:** `get_current_user`
- **Body:** `ProductCreate` (name, provider, amount, category, underlying, plus enrichment fields)
- **Response:** `Product` (201 Created)

#### `PATCH /products/{product_id}`

Update an existing product. Enforces ownership — only the product's `user_id` may update it (admins included).

- **Auth:** `get_current_user` + ownership check
- **Body:** `ProductUpdate` (all fields optional)
- **Response:** `Product`

#### `DELETE /products/{product_id}`

Delete a product. Enforces ownership.

- **Auth:** `get_current_user` + ownership check
- **Response:** 204 No Content

#### `GET /portfolio/me/summary`

Get portfolio summary (totals, distribution, largest position).

- **Auth:** `get_current_user`
- **Response:** `{"total_amount", "product_count", "categories_used", "distribution", "largest_position"}`

#### `GET /portfolio/me/export`

Stream a server-generated `.xlsx` file for the portfolio.

- **Auth:** `get_current_user`
- **Response:** `StreamingResponse` with media type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- **Filename:** `portafolio-sabbi-YYYY-MM-DD.xlsx`

### Portfolio Versioning Endpoints

**File:** `src/api/routes.py` — backed by `db/versioning.py`'s `VersioningRepository`. All require `get_current_user` and are scoped entirely to the authenticated user.

#### `POST /portfolio/me/snapshots`

Create a named, immutable point-in-time snapshot of the current portfolio.

- **Body:** `SnapshotCreate` (`{name, description?}`) — `name` is required, 1–200 chars
- **Response:** Snapshot summary dict (201 Created)
- **Error:** 409 when the portfolio is identical to the most recent snapshot (`SnapshotUnchangedError`)
- An empty portfolio is a valid snapshot (`product_count=0`, `total_amount=0`)

#### `GET /portfolio/me/snapshots`

List the user's snapshots, summary view, newest first.

- **Query params:** `limit: int = 50`, `offset: int = 0`
- **Response:** `{"snapshots": [...]}`

#### `GET /portfolio/me/snapshots/has-changes`

Whether the current portfolio differs from the latest snapshot.

- **Response:** `{"has_changes": bool}`

#### `GET /portfolio/me/snapshots/{snapshot_id}`

Get a single snapshot with its full materialized product list.

- **Response:** Snapshot detail dict including `products: [...]`
- **Error:** 404 both for a missing id and for a snapshot owned by another user (non-disclosing)
- No `PATCH`/`PUT` route exists — snapshots are immutable by omission.

#### `GET /portfolio/me/compare`

Compare two snapshots owned by the current user.

- **Query params:** `a: str`, `b: str` — snapshot UUIDs; `a` is always the baseline for `before`/`after` labeling regardless of query-param order
- **Response:** `{"snapshot_a", "snapshot_b", "added", "removed", "modified", "summary"}` — diffed by stable `product_id`, never by name
- **Errors:** 422 for a malformed UUID, 404 if a snapshot id doesn't exist, 403 if it exists but isn't owned by the user
- Registered at `/portfolio/me/compare` (not nested under `/snapshots/`) to avoid a FastAPI path conflict with the parametric `/portfolio/me/snapshots/{snapshot_id}` route.

#### `GET /portfolio/me/changes`

Paginated change log (audit trail) for the current user's own portfolio.

- **Query params:** `limit: int = 50`, `offset: int = 0`, `operation: str | None` — filter by `"create"|"update"|"delete"`
- **Response:** `{"changes": [...], "total": int, "has_more": bool}`

### Auth Endpoints

**File:** `src/api/auth_routes.py`

All routes under `/auth`. Cookie names: `sabbi_access` (15 min TTL), `sabbi_refresh` (7 day TTL).

#### `POST /auth/login`

Validate email/password and issue `sabbi_access` + `sabbi_refresh` cookies.

- **Body:** `LoginRequest` (`{email, password}`)
- **Response:** `{"user": {id, email, role}}`
- **Error:** 401 with generic "Invalid email or password" (never reveals whether the email exists)

#### `POST /auth/logout`

Clear auth cookies and delete the refresh token row from the database.

- **Cookie:** reads `sabbi_refresh` to find the token to revoke
- **Response:** `{"status": "logged_out"}`

#### `POST /auth/refresh`

Rotate the refresh token: validate signature AND DB lookup (a valid signature alone is not enough), delete the old token, issue a new access/refresh pair.

- **Cookie:** reads `sabbi_refresh`
- **Response:** `{"user": {id, email, role}}`
- **Errors:** 401 for missing/invalid/revoked/expired refresh tokens

#### `GET /auth/me`

Get the current authenticated user's profile, including their active thread ID.

- **Auth:** `get_current_user`
- **Response:** `UserResponse` (`{id, email, role, active_thread_id}`)

#### `PUT /auth/me/thread`

Set the user's active thread ID (persisted in the `users` table).

- **Auth:** `get_current_user`
- **Body:** `ThreadUpdate` (`{thread_id}`)
- **Response:** 204 No Content

### Chat Endpoints

**File:** `src/api/chat_routes.py`

All routes under `/chat`. These provide the conversational interface backed by a Postgres-checkpointed LangGraph graph.

#### `GET /chat/threads/{thread_id}/state`

Get the current state (message history) of a chat thread.

- **Auth:** `get_current_user`
- **Response:** `ThreadStateResponse` (`{thread_id, messages: [ApiMessage]}`)
- **Note:** Returns empty messages array if thread not found (no 404)

#### `POST /chat/threads/{thread_id}/messages/stream`

Send a message and stream the agent's response via SSE.

- **Auth:** `get_current_user`
- **Body:** `ChatMessageRequest` (`{message, attachments?}`)
- **Response:** `StreamingResponse` (SSE with progress/reasoning/text/final/error/done events)
- **Attachment handling:** Frontend `{type: "file"}` blocks are normalized to Anthropic's `{type: "image"|"document", source: {type: "base64", ...}}` format, or parsed to text for non-PDF/image formats
- **Returns 503** if the chat graph was not initialized. For the current FastAPI chat UI, this means `POSTGRES_URI` must be configured.

#### `DELETE /chat/threads/{thread_id}`

Delete a chat thread (currently a no-op that returns 204).

- **Auth:** `get_current_user`

### Admin Endpoints

**File:** `src/api/admin_routes.py`

All routes under `/admin`. Every route requires `require_admin` (role must be `"admin"`).

#### `GET /admin/users`

List all user accounts. Password hashes are always stripped from the response.

- **Response:** `[{id, email, role, created_at, ...}]`

#### `POST /admin/users`

Create a new user account. This is the ONLY way to create a user — no public registration endpoint exists.

- **Body:** `UserCreate` (`{email, password (min 8 chars), role ("user"|"admin")}`)
- **Response:** User record (201 Created)
- **Error:** 409 if email already exists

#### `GET /admin/portfolios`

List every user with a portfolio summary (product count, total amount).

- **Response:** `[{user_id, email, product_count, total}]`

#### `GET /admin/portfolios/{user_id}`

View a specific user's portfolio, read-only. Admins cannot edit another user's products.

- **Response:** `{"products": [Product]}`

#### `GET /admin/portfolios/{user_id}/changes`

Read-only change history for a specific client, admin-scoped. Reuses `VersioningRepository.list_changes`, called with the *target* client's `user_id`.

- **Query params:** `limit: int = 50`, `offset: int = 0`, `operation: str | None`
- **Response:** same shape as `GET /portfolio/me/changes`

#### `GET /admin/portfolios/{user_id}/snapshots`

Read-only snapshot list for a specific client, admin-scoped. No route exists here to create, modify, or delete a snapshot on behalf of another user.

- **Query params:** `limit: int = 50`, `offset: int = 0`
- **Response:** `{"snapshots": [...]}`

#### `GET /admin/products`

Cross-list every product across every user, with `user_email` attached to each row — avoids N+1 frontend calls for the catalog approval flow.

- **Response:** `[{...Product, "user_email": str}]`

#### `GET /admin/catalog/entries`

List all `product_catalog` entries.

- **Response:** `[CatalogProduct]`

#### `POST /admin/catalog/approve`

Approve a portfolio product into `product_catalog`, or replace an existing catalog entry when `catalog_product_id` is supplied.

- **Body:** `CatalogProductCreate` (`name`, `category` required; `asset_class`, `geographic_focus`, `underlying`, `commission`, `currency`, `administrator`, `manager`, `liquidity`, `return_rate`, `alternative_names`, `approved_from_product_id`, `catalog_product_id` optional)
- **Behavior:**
  - When `catalog_product_id` is set: replaces that catalog row (`CatalogRepository.replace_from_approval`) and returns 200. 404 if the id doesn't exist.
  - Otherwise: inserts a new catalog entry unless a normalized duplicate (same name + category + asset_class, case-insensitive) already exists (`CatalogRepository.insert_if_not_duplicate`), returning 409 on a duplicate.
- **Response:** `CatalogProduct` (201 Created on insert, 200 on replace)

#### `PATCH /admin/catalog/entries/{catalog_id}`

Partially update a catalog entry.

- **Body:** `CatalogProductUpdate` (all fields optional)
- **Response:** `CatalogProduct`
- **Error:** 404 if the id doesn't exist

#### `DELETE /admin/catalog/entries/{catalog_id}`

Delete a catalog entry. Catalog entries are not inline-editable beyond `PATCH` above — deletion is the only other supported mutation after approval.

- **Response:** 204 No Content
- **Error:** 404 if the id doesn't exist

#### `GET /admin/threads`

List users' current FastAPI chat threads from the `users.active_thread_id` column.

- **Response:** `[{thread_id, user_id, email, created_at}]` where `created_at` is the user's active-thread assignment timestamp.
- **Note:** The current runtime stores one active thread per user. This endpoint intentionally does not query LangGraph Platform.

#### `GET /admin/threads/{thread_id}`

View a specific thread's message history, read-only, using the same `app.state.chat_graph` source as the user-facing chat API.

- **Response:** `{"messages": [...]}`

---

## Database

### PostgreSQL Schema

**File:** `src/db/schema.sql`

The schema requires two PostgreSQL extensions:
- `pgcrypto` — for `gen_random_uuid()` used in primary key generation
- `pg_trgm` — for trigram-based fuzzy text search on the product catalog (including `alternative_names`)

#### `users` Table

```sql
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    active_thread_id TEXT
);
```

#### `refresh_tokens` Table

```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

Indexed on `user_id` for efficient lookup during token rotation.

#### `products` Table

```sql
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    provider TEXT DEFAULT '',
    amount NUMERIC NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    underlying JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- Enrichment fields (added via ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
    asset_class TEXT DEFAULT '',
    geographic_focus TEXT DEFAULT '',
    commission TEXT DEFAULT '',
    currency TEXT DEFAULT '',
    administrator TEXT DEFAULT '',
    manager TEXT DEFAULT '',
    liquidity TEXT DEFAULT '',
    return_rate TEXT DEFAULT '',
    catalog_product_id INTEGER
);
```

- Product IDs are application-generated: `prod_{uuid4_hex[:8]}` (e.g., `prod_1a2b3c4d`)
- `underlying` stores a JSON array of `{name, percentage}` objects (subcategory allocations)
- `catalog_product_id` links the product back to the `product_catalog` row it was sourced from, if any — used by the catalog approval flow
- Indexed on `user_id` and on `catalog_product_id`
- **Migration note:** this table previously had `subcategory TEXT` and `composition JSONB` columns. `subcategory` was dropped; `composition` was renamed to `underlying` (both handled by idempotent `ALTER TABLE`/`DO $$ ... $$` blocks in `schema.sql` so existing deployments migrate safely on next boot)

#### `product_catalog` Table

```sql
CREATE TABLE IF NOT EXISTS product_catalog (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    geographic_focus TEXT DEFAULT '',
    asset_class TEXT DEFAULT '',
    underlying JSONB DEFAULT '[]',
    commission TEXT DEFAULT '',
    currency TEXT DEFAULT '',
    administrator TEXT DEFAULT '',
    manager TEXT DEFAULT '',
    liquidity TEXT DEFAULT '',
    return_rate TEXT DEFAULT '',
    category TEXT DEFAULT '',
    approved_from_product_id TEXT,
    approved_at TIMESTAMPTZ,
    alternative_names TEXT[] DEFAULT '{}'
);
```

- Has a `gin_trgm_ops` GIN index on `name` for fuzzy similarity search
- Seeded from an external Excel file via `seed_catalog.py`; also grown organically via the admin catalog-approval flow (`POST /admin/catalog/approve`)
- `alternative_names` holds extra names/aliases the fuzzy search also matches against
- `approved_from_product_id`/`approved_at` trace an entry back to the portfolio product it was approved from, when applicable
- **Migration note:** `subcategory` was dropped; `underlying` was converted from `TEXT` to `JSONB DEFAULT '[]'` (idempotent `DO $$ ... $$` block in `schema.sql`)

#### `portfolio_snapshots` Table

```sql
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    product_count INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    category_summary JSONB DEFAULT '[]'
);
```

A named, immutable point-in-time record of a user's portfolio. `category_summary` caches a `[{category, percentage}]` breakdown so the snapshot list view doesn't need to re-aggregate `snapshot_products`. Indexed on `(user_id, created_at DESC)`.

#### `snapshot_products` Table

```sql
CREATE TABLE IF NOT EXISTS snapshot_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_data JSONB NOT NULL
);
```

Materializes every product's full field set (`Product.model_dump()`) at snapshot time, not just id/name/amount — so a snapshot survives later edits or deletes of the live product. Indexed on `snapshot_id` and `product_id`.

#### `portfolio_changes` Table

```sql
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
```

An append-only audit log of every product mutation, written in the same transaction as the mutation itself by `ProductRepository._log_change`. `source` attributes the change to the agent (chat tools), the REST API, or an admin action. Indexed on `(user_id, created_at DESC)`, `product_id`, and `snapshot_id` (partial index, `WHERE snapshot_id IS NOT NULL`).

### Connection Management

**File:** `src/db/connection.py`

The database connection is managed as a **process-wide singleton** `asyncpg.Pool`:

```python
async def get_pool() -> asyncpg.Pool:
```

On first call:
1. Creates a pool with `min_size=2, max_size=10` connections
2. Reads `DATABASE_URL` from environment (default: `postgresql://postgres:postgres@localhost:5432/sabbi`)
3. Runs `schema.sql` to ensure all tables/indexes exist
4. Seeds the admin user via `auth.seed.seed_admin()`

The pool is NOT passed through `RunnableConfig` because `asyncpg.Pool` cannot be serialized across the LangGraph API boundary. Tools call `get_pool()` directly.

Helper factories:

```python
def get_repository(pool) -> ProductRepository
def get_catalog_repository(pool) -> CatalogRepository
```

### Repository Pattern

#### `ProductRepository` (`src/db/repository.py`)

| Method | Signature | Description |
|--------|-----------|--------------|
| `list_by_user` | `(user_id: str) -> list[Product]` | All products for a user, ordered by `created_at` |
| `get` | `(product_id: str) -> Product \| None` | Single product lookup |
| `create` | `(user_id, data: ProductCreate, *, source="api", metadata=None, conn=None) -> Product` | Insert a product with a generated ID and log a `portfolio_changes` audit row, in one transaction |
| `update` | `(product_id, data: ProductUpdate, *, source="api", metadata=None, conn=None) -> Product \| None` | Partial update (only non-None fields) + audit log, one transaction. Returns `None` without logging when `product_id` doesn't exist |
| `delete` | `(product_id, *, source="api", metadata=None, conn=None) -> bool` | Delete + audit log, one transaction. Returns `False` without logging when `product_id` doesn't exist |
| `get_summary` | `(user_id: str) -> dict` | Aggregated portfolio stats: total amount, product count, category distribution, largest position |

`source` (`"agent" \| "api" \| "admin"`) and `metadata` attribute every mutation for the `portfolio_changes` audit trail. When `conn` is omitted, each method acquires its own pooled connection and wraps the write + audit-log insert in a single transaction; when `conn` is passed, the caller owns the surrounding transaction (used by callers that need the product write and other statements to commit/rollback together).

#### `CatalogRepository` (`src/db/catalog_repository.py`)

| Method | Signature | Description |
|--------|-----------|--------------|
| `list_all` | `() -> list[CatalogProduct]` | All catalog entries, ordered by `id` |
| `search` | `(query: str, limit: int = 5) -> list[CatalogProduct]` | Fuzzy search using `pg_trgm` similarity on `name`, `administrator`, and `alternative_names`, plus `ILIKE` fallback on `name`/`asset_class`/`alternative_names`. Results ordered by similarity score descending |
| `insert_if_not_duplicate` | `(data: CatalogProductCreate) -> CatalogProduct \| None` | Inserts a new entry unless a normalized match (name + category + asset_class, trimmed/case-insensitive) already exists; returns `None` on a duplicate instead of inserting |
| `replace_from_approval` | `(catalog_id: int, data: CatalogProductCreate) -> CatalogProduct \| None` | Overwrites an existing catalog row's fields (used when admin approval targets a known `catalog_product_id`); returns `None` if the id doesn't exist |
| `update` | `(catalog_id: int, data: CatalogProductUpdate) -> CatalogProduct \| None` | Partial update of a catalog entry |
| `delete` | `(catalog_id: int) -> bool` | Delete a catalog entry by id |

#### `VersioningRepository` (`src/db/versioning.py`)

Backs the portfolio snapshot/comparison/change-log feature set. Snapshots are immutable once created — this class intentionally exposes no update/delete method for `portfolio_snapshots`/`snapshot_products`.

| Method | Signature | Description |
|--------|-----------|--------------|
| `create_snapshot` | `(user_id, name, description="") -> dict` | Materializes every current product into a new immutable snapshot inside a `REPEATABLE READ` transaction with `SELECT ... FOR SHARE` on `products`, so a concurrent mutation can't commit mid-read. An empty portfolio is a valid snapshot (`product_count=0`). Raises `SnapshotUnchangedError` when the current portfolio is identical to the latest snapshot |
| `list_snapshots` | `(user_id, limit=50, offset=0) -> list[dict]` | Summary rows only (no product payload), newest first |
| `has_changes_since_latest` | `(user_id) -> bool` | Whether the live portfolio differs from the latest snapshot (or no snapshot exists yet) |
| `get_snapshot` | `(snapshot_id, user_id) -> dict \| None` | Single snapshot with its full materialized product list. Returns `None` (not an exception) for both "not found" and "owned by another user" — collapsed into one non-disclosing result |
| `compare_snapshots` | `(snapshot_a_id, snapshot_b_id, user_id) -> dict` | Structured diff (`added`/`removed`/`modified` + summary counts/deltas) between two snapshots, keyed by stable `product_id` (never by name). `snapshot_a_id` is always the baseline. Raises `SnapshotNotFoundError` / `SnapshotAccessError` for missing/unauthorized ids |
| `list_changes` | `(user_id, limit=50, offset=0, product_id=None, operation=None) -> dict` | Paginated `portfolio_changes` read, optionally filtered by `product_id` and/or `operation`. Returns `{"changes", "total", "has_more"}`. Reused as-is by the admin-scoped change-history route (called with the target client's `user_id`) |

#### `UserRepository` (`src/auth/repository.py`)

| Method | Signature | Description |
|--------|-----------|--------------|
| `get_by_email` | `(email: str) -> Record \| None` | User lookup by email |
| `get_by_id` | `(user_id: str) -> Record \| None` | User lookup by UUID |
| `create` | `(email, password_hash, role, created_by) -> Record` | Insert a new user |
| `list_all` | `() -> list[Record]` | All users ordered by `created_at` |
| `list_active_threads` | `() -> list[Record]` | All users with a non-empty `active_thread_id`, newest-updated first — backs `GET /admin/threads` |
| `store_refresh_token` | `(user_id, token_hash) -> None` | Persist a hashed refresh token with expiry |
| `get_refresh_token` | `(token_hash: str) -> Record \| None` | Lookup non-expired refresh token by hash |
| `delete_refresh_token` | `(token_hash: str) -> None` | Remove a refresh token (on rotation or logout) |
| `get_active_thread_id` | `(user_id: str) -> str \| None` | Read the user's current active chat thread |
| `set_active_thread_id` | `(user_id, thread_id) -> None` | Persist the user's active chat thread |

### Domain Models

**File:** `src/db/models.py`

```python
class AssetAllocation(BaseModel):
    name: str          # Canonical subcategory leaf, e.g. 'Deuda Privada'
    percentage: float  # 0-100

class Product(BaseModel):
    id: str             # e.g. 'prod_1a2b3c4d'
    user_id: str
    name: str
    provider: str = ""
    amount: float        # Must be > 0
    category: str        # One of: inversiones_directas, mercados_privados,
                          # club_deals, mercados_publicos, otros, cash_y_equivalentes
    underlying: list[AssetAllocation] = []
    asset_class: str = ""
    geographic_focus: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    catalog_product_id: int | None = None

class ProductCreate(BaseModel):
    name: str
    provider: str = ""
    amount: float
    category: str
    underlying: list[AssetAllocation] = []
    asset_class: str = ""
    geographic_focus: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    catalog_product_id: int | None = None
    # model_validator: if underlying is non-empty, percentages must sum to
    # ~100 (tolerance 0.5) or a ValueError is raised

class ProductUpdate(BaseModel):
    # All fields optional (None = "leave unchanged"), same field set as
    # ProductCreate plus the same underlying-sums-to-100 validator when a
    # non-empty underlying list is provided

class SnapshotCreate(BaseModel):
    name: str            # min_length=1, max_length=200
    description: str = ""

class CatalogProduct(BaseModel):
    id: int
    name: str
    geographic_focus: str = ""
    asset_class: str = ""
    underlying: list[AssetAllocation] = []
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    alternative_names: list[str] = []
    approved_from_product_id: str | None = None
    approved_at: str | None = None

class CatalogProductCreate(BaseModel):
    name: str
    category: str
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: list[AssetAllocation] = []
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    alternative_names: list[str] = []
    approved_from_product_id: str | None = None
    catalog_product_id: int | None = None  # set -> replace instead of insert

class CatalogProductUpdate(BaseModel):
    # All fields optional — partial PATCH payload for an existing catalog entry

FieldSource = Literal["catalog", "claude_knowledge", "web_search"]

class SearchResult(BaseModel):
    name: str = ""
    asset_class: str = ""
    geographic_focus: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    catalog_product_id: int | None = None
    primary_source: FieldSource = "catalog"
    provenance: dict[str, FieldSource] = {}
```

`Product`/`ProductCreate`/`ProductUpdate` no longer have `subcategory` or `composition` fields — allocation across subcategories is captured by `underlying: list[AssetAllocation]`, and `ProductCreate`/`ProductUpdate` enforce (via `model_validator`) that a non-empty `underlying` list sums to 100%. `CatalogProduct.underlying` is likewise a structured `list[AssetAllocation]` (previously free-text). `SearchResult` no longer carries `subcategory` or `underlying` — the cascade search only classifies `category`; subcategory allocation is decided by the agent/user when calling `propose_product`/`add_product`.

### Auth Models

**File:** `src/auth/models.py`

```python
class LoginRequest(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    active_thread_id: str | None = None

class ThreadUpdate(BaseModel):
    thread_id: str

class UserCreate(BaseModel):
    email: str
    password: str    # min_length=8
    role: str        # Must match "^(user|admin)$", default "user"
```

### Product Catalog Seeding

**File:** `src/db/seed_catalog.py`

CLI utility to populate the `product_catalog` table from an Excel spreadsheet:

```bash
python -m db.seed_catalog /path/to/products.xlsx
```

- Reads the active sheet starting from row 2 (assumes row 1 is headers)
- Truncates `product_catalog` before inserting (full replacement)
- Strips zero-width characters from all cell values
- Expected column order: name, geographic_focus, asset_class, underlying, commission, currency, administrator, manager, liquidity, return_rate

Beyond this bulk seed, `product_catalog` also grows organically through the admin catalog-approval flow (`POST /admin/catalog/approve`, backed by `CatalogRepository.insert_if_not_duplicate`/`replace_from_approval`), which lets an admin promote a real portfolio product into the shared catalog.

### Excel Export

**File:** `src/db/excel.py`

Server-side `.xlsx` generation using openpyxl. The workbook contains:

1. **"Portafolio Final" sheet** (index 0) — summary with columns: Categoría, Monto (USD), % del portafolio, # Productos. One row per category in the fixed order: `inversiones_directas`, `mercados_privados`, `club_deals`, `mercados_publicos`, `otros`, `cash_y_equivalentes`. Totals row at the bottom.

2. **One sheet per category** — each with columns: Nombre, Proveedor, Monto (USD), Underlying (a comma-joined `"{name} {percentage:.0f}%"` summary of the product's `underlying` list, via `_underlying_summary()`). Only categories with at least one product get a sheet.

Styling: indigo header fill (`#4F46E5`), white bold header font, currency format `"$"#,##0`, percentage format `0.0%`, auto-sized columns at 26 characters width.

```python
def build_portfolio_workbook(products: list[Product]) -> io.BytesIO
def export_filename() -> str  # Returns 'portafolio-sabbi-YYYY-MM-DD.xlsx'
```

---

## Authentication

### Overview

SABBI uses **cookie-based JWT authentication** with a dual-token approach:

| Cookie | TTL | Secret Env Var | Purpose |
|--------|-----|----------------|---------|
| `sabbi_access` | 15 minutes | `JWT_SECRET` | Short-lived access token for route authorization |
| `sabbi_refresh` | 7 days | `JWT_REFRESH_SECRET` | Long-lived refresh token for session continuity |

Both cookies are `httpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` only in production (when `NODE_ENV=production` or `ENV=production`).

### Token Structure

**File:** `src/auth/tokens.py`

Access token claims: `{sub: user_id, email, role, type: "access", iat, exp}`

Refresh token claims: `{sub: user_id, type: "refresh", iat, exp}`

Algorithm: HS256

### Token Lifecycle

1. **Login** (`POST /auth/login`): validates email/password, issues access + refresh tokens as cookies, stores `hash_refresh_token(refresh_token)` in `refresh_tokens` table
2. **API requests**: `get_current_user` dependency reads `sabbi_access` cookie, decodes it, returns `{id, email, role}`
3. **Token refresh** (`POST /auth/refresh`): validates refresh token signature AND DB lookup (both required), deletes old token row, issues new pair (rotation)
4. **Logout** (`POST /auth/logout`): deletes refresh token from DB, clears both cookies

### Password Hashing

**File:** `src/auth/passwords.py`

Uses **bcrypt** with auto-generated salt. Plaintext passwords are never persisted or logged.

```python
def hash_password(plain_password: str) -> str
def verify_password(plain_password: str, hashed_password: str) -> bool
```

### Admin Seeding

**File:** `src/auth/seed.py`

On every startup, `seed_admin()` is called by `db.connection.get_pool()` after the schema is applied. It creates the initial admin user from environment variables:

- `ADMIN_EMAIL` — admin account email
- `ADMIN_PASSWORD` — admin account password

No-op if the admin already exists or if the env vars are not set (logs a warning).

### Access Control Dependencies

**File:** `src/auth/dependencies.py`

```python
async def get_current_user(sabbi_access: str | None = Cookie(default=None)) -> dict
```

Reads the `sabbi_access` cookie, decodes it via `decode_access_token()`, returns `{id, email, role}`. Raises 401 for missing, expired, or invalid tokens.

```python
async def require_admin(user = Depends(get_current_user)) -> dict
```

Wraps `get_current_user`, additionally requiring `role == "admin"`. Raises 403 if the user is not an admin.

### Ownership Enforcement

Portfolio product mutations (`PATCH /products/{id}`, `DELETE /products/{id}`) enforce ownership: only the product's `user_id` may act on it. This applies even to admin users — admin access to other users' data is read-only via `/admin/portfolios/{user_id}` (and its `changes`/`snapshots` sub-resources).

---

## Product Search (Cascade)

**File:** `src/agent/search.py`

### Architecture

The `cascade_search` function implements a three-level product data lookup that stops as soon as every field is populated:

```
L1: SABBI Catalog (pg_trgm)  →  Most trusted, fastest
L2: Claude Knowledge (Haiku)  →  Mid-trust, structured extraction
L3: Tavily Web Search         →  Least trusted, last resort
```

Each level only fills fields the previous level left empty. Catalog data is always authoritative — `_merge_fields` never overwrites an already-populated field.

### Search Fields

All 10 fields are searched at every level (field parity):

```
name, asset_class, geographic_focus, commission, currency,
administrator, manager, liquidity, return_rate, category
```

`subcategory` and `underlying` are no longer part of the cascade search's field set — `SearchResult` only classifies `category`; subcategory/underlying allocation is decided later when the agent (or user, via the confirmation card) calls `propose_product`/`add_product`.

### Level Details

#### L1 — Catalog Search (`_search_catalog`)

Uses `CatalogRepository.search()` with `pg_trgm` similarity on `name`, `administrator`, and `alternative_names`. Takes the top match. All fields from this level are tagged with `provenance: "catalog"`, and the match's `id` is stored on `SearchResult.catalog_product_id`.

#### L2 — Claude Knowledge (`_extract_from_claude`)

A separate, non-streaming structured-output call to `claude-haiku-4-5` using `ExtractedProduct` as the Pydantic output schema. Prompted to use only its own training knowledge. Fields tagged with `provenance: "claude_knowledge"`.

#### L3 — Tavily Web Search (`_search_tavily`)

Last-resort web search via the Tavily API. Requires `TAVILY_API_KEY` env var — skips gracefully (returns `{}`) when unset or on any error. The search results are fed back through `claude-haiku-4-5` for grounded extraction. Fields tagged with `provenance: "web_search"`.

### Category Normalization (`_sanitize_taxonomy`)

Before classification, `_sanitize_taxonomy` clears any `category` value that doesn't match a canonical taxonomy key/label OR one of the recognized legacy short keys/labels in `_LEGACY_CATEGORY_LABELS` (`directas`, `privados`, `club`, `publicos`, `cash`, and their older Spanish-label equivalents) — e.g. a free-text value like `"Diversificado"` returned by a catalog row gets wiped so `_classify` can re-attempt auto-classification or the agent asks the user.

### Auto-Classification (`_classify`)

After all search levels complete, if `category` is still empty, the function attempts auto-classification by matching known field values (`name`, `asset_class`, `geographic_focus`) against the `CATEGORIES` taxonomy leaves. Only assigns a classification when exactly one leaf matches — ambiguous matches are left empty so the agent asks the user.

### Source Trust Ranking

```python
_SOURCE_RANK = {"catalog": 0, "claude_knowledge": 1, "web_search": 2}
```

`primary_source` tracks the LEAST trusted level that contributed any field, so the frontend card badge reflects the weakest link in the data.

### Entry Point

```python
async def cascade_search(query: str, pool: asyncpg.Pool) -> SearchResult | None
```

Returns `None` only if all three levels find nothing.

---

## Deployment

### Dockerfile

**File:** `apps/backend/Dockerfile` (described in root CLAUDE.md)

The current Dockerfile starts the FastAPI API app:

```
gunicorn api.routes:app \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --timeout 120 \
  --graceful-timeout 30
```

- 4 worker processes (adjust to CPU count)
- 120s timeout for long-running LLM streaming responses
- 30s graceful timeout for in-flight requests on reload

This runtime serves the FastAPI routes documented above (`/auth`, `/portfolio`, `/products`, `/admin`, `/chat`). `POSTGRES_URI` must be set for the chat graph checkpointer/store; otherwise `/chat/*` returns 503.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|--------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude models |
| `DATABASE_URL` | Yes | `postgresql://postgres:postgres@localhost:5432/sabbi` | PostgreSQL connection string for portfolio data |
| `POSTGRES_URI` | Yes for `/chat/*` | — | PostgreSQL URI for LangGraph checkpointer/store used by the FastAPI chat endpoints. If unset, chat endpoints return 503. |
| `JWT_SECRET` | Yes (at runtime) | — | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Yes (at runtime) | — | Secret for signing refresh tokens |
| `ADMIN_EMAIL` | No | — | Initial admin account email (seed on first boot) |
| `ADMIN_PASSWORD` | No | — | Initial admin account password |
| `TAVILY_API_KEY` | No | — | Tavily API key for L3 web search. If unset, web search is skipped gracefully. |
| `LANGSMITH_API_KEY` | No | — | LangSmith API key for tracing |
| `LANGSMITH_TRACING` | No | — | Set to `true` to enable LangSmith tracing |
| `LANGSMITH_PROJECT` | No | — | LangSmith project name |
| `NODE_ENV` or `ENV` | No | — | Set to `production` to enable `Secure` flag on auth cookies |

### Dev Scripts

**File:** `apps/backend/package.json`

| Script | Command | Description |
|--------|---------|--------------|
| `dev` | `concurrently -n graph,api -c blue,green "yarn dev:graph:lite" "yarn dev:api"` | Run both services in parallel |
| `dev:graph` | `langgraph up --port 2024 --watch` | LangGraph with Docker (full mode) |
| `dev:graph:lite` | `langgraph dev --host 0.0.0.0 --port 2024 --no-browser` | LangGraph in-memory dev server |
| `dev:api` | `uvicorn api.routes:app --app-dir src --reload --port 3003 --log-level debug` | FastAPI with hot-reload (prefers a local `.venv/bin/uvicorn` if present, else falls back to the `uvicorn` on `PATH`) |
| `lint` | `ruff check src/` | Lint with Ruff (same `.venv`-first fallback pattern) |
| `test` | `pytest -q` | Run test suite (same `.venv`-first fallback pattern) |

### CI/CD

**GitHub Actions workflow:** `.github/workflows/deploy-backend.yml`

1. Build Docker image with Gunicorn + Uvicorn
2. Push to AWS ECR (private repository)
3. SSH into EC2 instance, pull new image, restart container on port 8000

The backend deploy is path-filtered — only triggered by changes under `apps/backend/`.

### Testing

**File:** `apps/backend/pyproject.toml` — `[tool.pytest.ini_options]`

```toml
pythonpath = ["src"]
testpaths = ["tests"]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
asyncio_default_test_loop_scope = "session"
```

Test suite uses `pytest` with `pytest-asyncio` and `httpx` for async HTTP testing. Integration tests under `tests/integration/` require a real PostgreSQL instance and cover the catalog/versioning/admin flows against real Postgres (`test_admin_catalog_pg.py`, `test_catalog_repository_pg.py`, `test_repository_audit_pg.py`, `test_versioning_repository_pg.py`, `test_routes_pg.py`, `test_tools_pg.py`, `test_chat_pg.py`) in addition to the mocked-DB unit tests at the top level (e.g. `test_versioning_routes.py`, `test_admin_routes.py`). Session-scoped event loop ensures asyncpg connections are shared across tests within the same session.
