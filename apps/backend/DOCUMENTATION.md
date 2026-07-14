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
- **Anthropic Claude** (`claude-sonnet-5` for the agent, `claude-haiku-4-5` for structured extraction)
- **FastAPI** >= 0.115 (REST API)
- **asyncpg** >= 0.29 (PostgreSQL async driver)
- **PostgreSQL** >= 14 (with `pgcrypto` and `pg_trgm` extensions)
- **openpyxl** >= 3.1 (server-side Excel export)
- **bcrypt** >= 4.1 (password hashing)
- **PyJWT** >= 2.8 (JWT token management)
- **Tavily** >= 0.5 (web search fallback for product lookup)

### Directory Structure

```
apps/backend/
├── langgraph.json              # LangGraph server config (graph ID "agent")
├── package.json                # Yarn workspace scripts (dev, lint, test)
├── pyproject.toml              # Python project metadata and dependencies
├── requirements.txt            # Minimal pip requirements (subset of pyproject.toml)
├── src/
│   ├── agent/                  # LangGraph conversational agent
│   │   ├── __init__.py
│   │   ├── graph.py            # Graph definition and compilation
│   │   ├── nodes.py            # Node functions (router, process_document, agent)
│   │   ├── prompts.py          # System prompt (Spanish, investment-focused)
│   │   ├── search.py           # Cascading L1→L2→L3 product search
│   │   ├── state.py            # AgentState schema + CATEGORIES taxonomy
│   │   └── tools.py            # Portfolio tools (search, propose, add, update, delete, summary)
│   ├── api/                    # FastAPI REST API
│   │   ├── __init__.py         # Re-exports `app` from routes.py
│   │   ├── routes.py           # Portfolio CRUD + Excel export + app lifespan
│   │   ├── auth_routes.py      # Login, logout, refresh, me, thread management
│   │   ├── chat_routes.py      # Chat SSE streaming + thread state
│   │   └── admin_routes.py     # Admin-only user/portfolio/thread management
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
│       ├── catalog_repository.py  # CatalogRepository (pg_trgm similarity search)
│       ├── connection.py       # Singleton asyncpg pool + schema auto-apply
│       ├── excel.py            # Server-side .xlsx workbook generation
│       ├── models.py           # Pydantic domain models (Product, SearchResult, etc.)
│       ├── repository.py       # ProductRepository (products table CRUD)
│       ├── schema.sql          # DDL for all tables, indexes, extensions
│       └── seed_catalog.py     # CLI to populate product_catalog from Excel
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
| `directas` | Real Estate Directo | RE Peru (Residencial, Oficinas, Comercial/Industrial), RE Extranjero |
| `privados` | Mercados Privados | Deuda Privada, Private Equity, Venture Capital, Real Estate, Hedge Funds, Infraestructura |
| `club` | Club Deals | Real Estate (Peru, Extranjero), Deuda Privada (Peru, Extranjero), Otros (Peru, Extranjero) |
| `publicos` | Mercados Publicos | Renta Variable (US Large Cap, US Mid & Small Cap, Developed ex-US, EM ex-Peru, Peru), Renta Fija (US Treasuries, IG Corporates AAA-BBB, High Yield BB-, EM Bonds, LatAm Bonds, Peru Bonds) |
| `otros` | Otros | Cripto (Bitcoin, Ethereum, Otras), Commodities (Oro) |
| `cash` | Cash y Equivalentes | Cash (Depositos a plazo, Fondos de Money Market) |

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

1. **Search-first workflow:** When the user mentions a product, ALWAYS call `search_product` first to investigate it via the cascade search.
2. **Propose-before-add:** NEVER call `add_product` directly. The flow is: `search_product` → `propose_product` (renders a confirmation card in the UI) → user confirms → `add_product`.
3. **No fabrication:** NEVER invent values for fields that `search_product` left empty (commission, currency, administrator, etc.).
4. **Subcategory forwarding:** Always extract and forward the `subcategory` from the user's confirmation to `add_product`.
5. **Auto-classification:** If `search_product` returned `category` and `subcategory` with confidence, use them directly. If not, ask the user explicitly.
6. **Never reveal internals:** Never mention the catalog, cascade search levels, or data provenance to the user — that information is for the UI badges only.

The prompt is dynamically constructed with `_format_categories()` which renders the full 3-level taxonomy from `CATEGORIES`.

### Tool Definitions

**File:** `src/agent/tools.py`

All tools persist directly to PostgreSQL via `ProductRepository`. The `user_id` is supplied per-run via `RunnableConfig["configurable"]["user_id"]` — injected by the Next.js proxy from the authenticated JWT subject claim.

#### `search_product(query: str) -> dict`

Searches for an investment product via the three-level cascade (L1 catalog → L2 Claude knowledge → L3 Tavily web search). Returns enrichment fields and provenance metadata.

- **Parameters:** `query` — product name, ticker, or description
- **Returns:** `{"status": "found"|"not_found", "query": str, "result": SearchResult}` or `{"status": "not_found", "query": str}`

#### `propose_product(name, amount, category, ...) -> dict`

Proposes adding a product and asks the user to confirm via a UI card with Yes/No buttons. Must be called INSTEAD of `add_product` when a product is first identified.

- **Parameters:**
  - `name: str` — product name
  - `amount: float` — investment amount in USD
  - `category: str` — one of: directas, privados, club, publicos, otros, cash
  - `provider: str = ""` — provider/fund manager
  - `composition: list[dict] | None` — asset class allocations `[{name, percentage}]`
  - `asset_class, currency, commission, administrator, manager, liquidity, return_rate, geographic_focus, subcategory: str` — enrichment fields from `search_product`
  - `primary_source: FieldSource` — weakest data source across all fields
  - `provenance: dict[str, FieldSource] | None` — per-field source map
- **Returns:** `{"status": "proposed", "product": {..., "reliability_tag": "verified"|"web"|"unverified"}}`
- **Reliability tag derivation** (`_derive_card_tag`):
  - All fields sourced from `catalog` → `"verified"`
  - Mix including `catalog` or `web_search` → `"web"`
  - Only `claude_knowledge` or empty → `"unverified"`

#### `add_product(name, amount, category, ...) -> dict`

Adds a new investment product to the user's portfolio in PostgreSQL.

- **Parameters:**
  - `name: str`, `amount: float`, `category: str`
  - `provider: str = ""`, `subcategory: str = ""`
  - `composition: list[dict] | None` — defaults to `[{name: product_name, percentage: 100}]`
- **Returns:** `{"status": "added", "product": Product}`
- **Requires:** `user_id` from `RunnableConfig["configurable"]`

#### `update_product(product_id, ...) -> dict`

Updates an existing product.

- **Parameters:** `product_id: str`, plus optional `name`, `provider`, `amount`, `category`, `composition`
- **Returns:** `{"status": "updated"|"error", ...}`

#### `delete_product(product_id) -> dict`

Removes a product from the portfolio.

- **Parameters:** `product_id: str`
- **Returns:** `{"status": "deleted"|"error", ...}`

#### `get_portfolio_summary() -> dict`

Returns portfolio overview: totals, category distribution, and largest position.

- **Requires:** `user_id` from `RunnableConfig["configurable"]`
- **Returns:** `{"total_amount", "product_count", "categories_used", "distribution", "largest_position"}`

### Document Processing

**File:** `src/agent/nodes.py`

When a user uploads a file (PDF, image, spreadsheet), the `router` node detects the attachment via `has_file_attachment()` and routes to `process_document_node`.

**Attachment detection** (`_has_attachment`): checks if any content block in the last message has `type` in `("image_url", "image", "document", "file")`.

**Extraction prompt** (`EXTRACTION_PROMPT`): instructs Claude to analyze the attached document, extract ALL investment products (name, provider, amount, category, composition), present them in a clear list, and use `add_product` for each one.

The extraction prompt is injected as a `SystemMessage` (not a `HumanMessage`) so it does not render as a user bubble in the chat UI.

### Message Normalization

**File:** `src/agent/nodes.py`

Several helper functions ensure robustness across checkpoint restores and multi-turn conversations:

| Function | Purpose |
|----------|---------|
| `_strip_thinking(msg)` | Removes `thinking` blocks from previous AI messages so they do not get re-sent to the API (checkpoints often drop the inner thinking text, causing 400 errors) |
| `_normalize_file_blocks(msg)` | Converts `{type: "file"}` content blocks from older sessions to Anthropic's expected `document` or `image` format |
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
2. Attaches `ProductRepository` and `UserRepository` to `app.state`
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

Portfolio routes are defined directly on the main `app` (no prefix).

### Portfolio Endpoints

All portfolio endpoints require `get_current_user` (valid `sabbi_access` cookie).

#### `GET /portfolio/me`

List all products for the authenticated user.

- **Auth:** `get_current_user`
- **Response:** `{"products": [Product]}`

#### `POST /portfolio/me/products`

Create a new product.

- **Auth:** `get_current_user`
- **Body:** `ProductCreate` (name, provider, amount, category, subcategory, composition)
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
- **Attachment handling:** Frontend `{type: "file"}` blocks are normalized to Anthropic's `{type: "image"|"document", source: {type: "base64", ...}}` format
- **Returns 503** if the chat graph was not initialized (missing `POSTGRES_URI`)

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

#### `GET /admin/threads`

List all LangGraph threads across users (via LangGraph SDK client).

- **Response:** `[{thread_id, user_id, created_at}]`
- **Note:** Threads created before auth may lack `metadata.owner_user_id` — surfaced as `user_id: null`

#### `GET /admin/threads/{thread_id}`

View a specific thread's message history, read-only.

- **Response:** `{"messages": [...]}`

---

## Database

### PostgreSQL Schema

**File:** `src/db/schema.sql`

The schema requires two PostgreSQL extensions:
- `pgcrypto` — for `gen_random_uuid()` used in primary key generation
- `pg_trgm` — for trigram-based fuzzy text search on the product catalog

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
    subcategory TEXT DEFAULT '',
    composition JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

- Product IDs are application-generated: `prod_{uuid4_hex[:8]}` (e.g., `prod_1a2b3c4d`)
- `composition` stores a JSON array of `{name, percentage}` objects
- Indexed on `user_id`

#### `product_catalog` Table

```sql
CREATE TABLE IF NOT EXISTS product_catalog (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    geographic_focus TEXT DEFAULT '',
    asset_class TEXT DEFAULT '',
    underlying TEXT DEFAULT '',
    commission TEXT DEFAULT '',
    currency TEXT DEFAULT '',
    administrator TEXT DEFAULT '',
    manager TEXT DEFAULT '',
    liquidity TEXT DEFAULT '',
    return_rate TEXT DEFAULT '',
    category TEXT DEFAULT '',
    subcategory TEXT DEFAULT ''
);
```

- Has a `gin_trgm_ops` GIN index on `name` for fuzzy similarity search
- Seeded from an external Excel file via `seed_catalog.py`

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
|--------|-----------|-------------|
| `list_by_user` | `(user_id: str) -> list[Product]` | All products for a user, ordered by `created_at` |
| `get` | `(product_id: str) -> Product | None` | Single product lookup |
| `create` | `(user_id: str, data: ProductCreate) -> Product` | Insert a new product with generated ID |
| `update` | `(product_id: str, data: ProductUpdate) -> Product | None` | Partial update (only non-None fields), sets `updated_at` |
| `delete` | `(product_id: str) -> bool` | Delete by ID, returns True if a row was removed |
| `get_summary` | `(user_id: str) -> dict` | Aggregated portfolio stats: total amount, product count, category distribution, largest position |

#### `CatalogRepository` (`src/db/catalog_repository.py`)

| Method | Signature | Description |
|--------|-----------|-------------|
| `search` | `(query: str, limit: int = 5) -> list[CatalogProduct]` | Fuzzy search using `pg_trgm` similarity on `name`, `underlying`, and `administrator` columns, plus `ILIKE` fallback on `name`, `underlying`, `asset_class`. Results ordered by similarity score descending. |

#### `UserRepository` (`src/auth/repository.py`)

| Method | Signature | Description |
|--------|-----------|-------------|
| `get_by_email` | `(email: str) -> Record | None` | User lookup by email |
| `get_by_id` | `(user_id: str) -> Record | None` | User lookup by UUID |
| `create` | `(email, password_hash, role, created_by) -> Record` | Insert a new user |
| `list_all` | `() -> list[Record]` | All users ordered by `created_at` |
| `store_refresh_token` | `(user_id, token_hash) -> None` | Persist a hashed refresh token with expiry |
| `get_refresh_token` | `(token_hash: str) -> Record | None` | Lookup non-expired refresh token by hash |
| `delete_refresh_token` | `(token_hash: str) -> None` | Remove a refresh token (on rotation or logout) |
| `get_active_thread_id` | `(user_id: str) -> str | None` | Read the user's current active chat thread |
| `set_active_thread_id` | `(user_id, thread_id) -> None` | Persist the user's active chat thread |

### Domain Models

**File:** `src/db/models.py`

```python
class AssetAllocation(BaseModel):
    name: str          # Asset class name, e.g. 'Deuda privada'
    percentage: float   # 0-100

class Product(BaseModel):
    id: str             # e.g. 'prod_1a2b3c4d'
    user_id: str
    name: str
    provider: str = ""
    amount: float       # Must be > 0
    category: str       # One of: directas, privados, club, publicos, otros, cash
    subcategory: str = ""
    composition: list[AssetAllocation] = []

class ProductCreate(BaseModel):
    name: str
    provider: str = ""
    amount: float       # Must be > 0
    category: str
    subcategory: str = ""
    composition: list[AssetAllocation] = []

class ProductUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    amount: float | None = None
    category: str | None = None
    subcategory: str | None = None
    composition: list[AssetAllocation] | None = None

class CatalogProduct(BaseModel):
    id: int
    name: str
    geographic_focus: str = ""
    asset_class: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    subcategory: str = ""

FieldSource = Literal["catalog", "claude_knowledge", "web_search"]

class SearchResult(BaseModel):
    name: str = ""
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    subcategory: str = ""
    primary_source: FieldSource = "catalog"
    provenance: dict[str, FieldSource] = {}
```

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

### Excel Export

**File:** `src/db/excel.py`

Server-side `.xlsx` generation using openpyxl. The workbook contains:

1. **"Portafolio Final" sheet** (index 0) — summary with columns: Categoria, Monto (USD), % del portafolio, # Productos. One row per category in the fixed order: directas, privados, club, publicos, otros, cash. Totals row at the bottom.

2. **One sheet per category** — each with columns: Nombre, Subcategoria, Proveedor, Monto (USD), Composicion. Only categories with at least one product get a sheet.

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

Portfolio product mutations (`PATCH /products/{id}`, `DELETE /products/{id}`) enforce ownership: only the product's `user_id` may act on it. This applies even to admin users — admin access to other users' data is read-only via `/admin/portfolios/{user_id}`.

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

All 12 fields are searched at every level (field parity):

```
name, asset_class, geographic_focus, underlying, commission, currency,
administrator, manager, liquidity, return_rate, category, subcategory
```

### Level Details

#### L1 — Catalog Search (`_search_catalog`)

Uses `CatalogRepository.search()` with `pg_trgm` similarity on `name`, `underlying`, `administrator` columns. Takes the top match. All fields from this level are tagged with `provenance: "catalog"`.

#### L2 — Claude Knowledge (`_extract_from_claude`)

A separate, non-streaming structured-output call to `claude-haiku-4-5` using `ExtractedProduct` as the Pydantic output schema. Prompted to use only its own training knowledge. Fields tagged with `provenance: "claude_knowledge"`.

#### L3 — Tavily Web Search (`_search_tavily`)

Last-resort web search via the Tavily API. Requires `TAVILY_API_KEY` env var — skips gracefully (returns `{}`) when unset or on any error. The search results are fed back through `claude-haiku-4-5` for grounded extraction. Fields tagged with `provenance: "web_search"`.

### Auto-Classification (`_classify`)

After all search levels complete, if `category` and `subcategory` are still empty, the function attempts auto-classification by matching known field values (name, asset_class, geographic_focus, underlying) against the `CATEGORIES` taxonomy leaves. Only assigns a classification when exactly one leaf matches — ambiguous matches are left empty so the agent asks the user.

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

Uses **Gunicorn with Uvicorn workers** for production:

```
gunicorn langgraph_api.server:app \
  --bind 0.0.0.0:8000 \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --timeout 120 \
  --graceful-timeout 30
```

- 4 worker processes (adjust to CPU count)
- 120s timeout for long-running LLM streaming responses
- 30s graceful timeout for in-flight requests on reload

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude models |
| `DATABASE_URL` | Yes | `postgresql://postgres:postgres@localhost:5432/sabbi` | PostgreSQL connection string for portfolio data |
| `POSTGRES_URI` | No | — | PostgreSQL URI for LangGraph checkpointer/store (chat persistence). If unset, chat endpoints return 503. |
| `JWT_SECRET` | Yes (at runtime) | — | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Yes (at runtime) | — | Secret for signing refresh tokens |
| `ADMIN_EMAIL` | No | — | Initial admin account email (seed on first boot) |
| `ADMIN_PASSWORD` | No | — | Initial admin account password |
| `TAVILY_API_KEY` | No | — | Tavily API key for L3 web search. If unset, web search is skipped gracefully. |
| `LANGSMITH_API_KEY` | No | — | LangSmith API key for tracing |
| `LANGSMITH_TRACING` | No | — | Set to `true` to enable LangSmith tracing |
| `LANGSMITH_PROJECT` | No | — | LangSmith project name |
| `LANGGRAPH_API_URL` | No | `http://localhost:2024` | LangGraph SDK endpoint (used by admin thread routes) |
| `NODE_ENV` or `ENV` | No | — | Set to `production` to enable `Secure` flag on auth cookies |

### Dev Scripts

**File:** `apps/backend/package.json`

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `concurrently "yarn dev:graph:lite" "yarn dev:api"` | Run both services in parallel |
| `dev:graph` | `langgraph up --port 2024 --watch` | LangGraph with Docker (full mode) |
| `dev:graph:lite` | `langgraph dev --host 0.0.0.0 --port 2024 --no-browser` | LangGraph in-memory dev server |
| `dev:api` | `uvicorn api.routes:app --app-dir src --reload --port 3003` | FastAPI with hot-reload |
| `lint` | `ruff check src/` | Lint with Ruff |
| `test` | `pytest -q` | Run test suite |

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

Test suite uses `pytest` with `pytest-asyncio` and `httpx` for async HTTP testing. Integration tests under `tests/integration/` require a real PostgreSQL instance. Session-scoped event loop ensures asyncpg connections are shared across tests within the same session.
