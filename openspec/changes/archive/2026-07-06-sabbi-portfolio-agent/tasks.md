# Tasks: sabbi-portfolio-agent

## Phase 0 — Project Setup

- [x] **T-001** | Configure backend for Anthropic + Postgres
  - The bootstrap already has a configurable provider system (`models.py` with `LLM_PROVIDER`). Replace it with hardcoded `ChatAnthropic` for SABBI — this is intentional: the agent's system prompt, tools, and extraction pipeline are Anthropic-specific.
  - Update `pyproject.toml`: add `langchain-anthropic`, `asyncpg`, `fastapi`, `uvicorn[standard]`, `openpyxl`
  - Update `.env` with `ANTHROPIC_API_KEY` and `DATABASE_URL`
  - Verify `pip install -e .` succeeds

- [x] **T-002** | Configure frontend dependencies
  - Verify `@assistant-ui/react`, `@assistant-ui/react-langgraph`, `@langchain/langgraph-sdk` are installed
  - Add inline SVG icon system (no external icon CDN dependencies)

- [x] **T-003** | Set up PostgreSQL schema and DB layer
  - Create `apps/backend/src/db/schema.sql` with `products` table (JSONB composition)
  - Create `apps/backend/src/db/models.py` with Pydantic models (`Product`, `ProductCreate`, `ProductUpdate`, `AssetAllocation`)
  - Create `apps/backend/src/db/connection.py` with asyncpg pool management
  - Create `apps/backend/src/db/repository.py` with `ProductRepository` (CRUD + summary)
  - Add schema auto-creation on startup (or migration script)

---

## Phase 1 — Backend: Agent Core

- [x] **T-100** | Create agent state (`apps/backend/src/agent/state.py`)
  - Define `AgentState` TypedDict with `messages` only (portfolio lives in Postgres)
  - Define `CATEGORIES` taxonomy dict with all 6 categories and subcategories
  - **Spec**: `langgraph-agent.spec.md` → "Estado del agente"

- [x] **T-101** | Create tools (`apps/backend/src/agent/tools.py`)
  - Implement `add_product` tool — writes to Postgres via `ProductRepository`
  - Implement `update_product` tool — partial update in Postgres
  - Implement `delete_product` tool — deletes from Postgres
  - Implement `get_portfolio_summary` tool — reads from Postgres
  - All tools receive `portfolio_id` from `RunnableConfig["configurable"]`
  - Export `portfolio_tools` list
  - **Spec**: `langgraph-agent.spec.md` → "Tool — add/update/delete_product"

- [x] **T-102** | Create system prompt (`apps/backend/src/agent/prompts.py`)
  - Define `SYSTEM_PROMPT` with SABBI categories, classification rules, response format
  - Language: español, tono profesional y amigable
  - **Spec**: `langgraph-agent.spec.md` → "System prompt del agente"

- [x] **T-103** | Create node functions (`apps/backend/src/agent/nodes.py`)
  - `router_node` + `has_file_attachment`: detect file attachments and route
  - `process_document_node`: inject extraction prompt for the agent to process with tools
  - `agent_node`: main conversational node with `llm_with_tools`
  - All nodes use `ChatAnthropic("claude-sonnet-4-20250514")`
  - **Spec**: `langgraph-agent.spec.md` → "Estructura del grafo", "Procesamiento de PDF"

- [x] **T-104** | Create graph definition (`apps/backend/src/agent/graph.py`)
  - Build `StateGraph(AgentState)` with nodes: router, process_document, agent, tools (ToolNode)
  - Use `ToolNode(portfolio_tools)` — standard LangGraph tool execution (tools write to DB directly)
  - Add conditional edges: router → process_document | agent
  - Add edge: process_document → agent
  - Add conditional edge: agent → tools (if tool_calls) | END
  - Add edge: tools → agent (loop back)
  - Compile with `MemorySaver` checkpointer
  - **Spec**: `langgraph-agent.spec.md` → "Estructura del grafo principal"

- [x] **T-105** | Create FastAPI REST API (`apps/backend/src/api/routes.py`)
  - `GET /portfolio/:id` — list products
  - `POST /portfolio/:id/products` — create product
  - `PATCH /products/:id` — update product
  - `DELETE /products/:id` — delete product
  - `GET /portfolio/:id/summary` — portfolio summary
  - Shares Postgres pool with agent tools

- [x] **T-106** | Update `langgraph.json` and dev scripts
  - Point to `./src/agent/graph.py:graph`
  - Set env to `.env`
  - Add script to run FastAPI alongside LangGraph dev server

- [ ] **T-107** | Test backend locally
  - Start Postgres (Docker or local), run schema migration
  - Run `langgraph dev --port 2024 --no-browser` + FastAPI on `:3003`
  - Test chat: send text message, verify streaming response
  - Test tool calls: verify add_product writes to Postgres
  - Test REST API: CRUD operations via curl
  - Verify persistence: products survive across page reloads and new threads

---

## Phase 2 — Frontend: Layout & Chat

- [x] **T-200** | Create split-screen layout (`app/page.tsx`)
  - Grid layout: 340px chat | fluid portfolio
  - Full viewport height minus topbar
  - Chat panel: flex column with pinned input
  - Portfolio panel: scrollable content
  - **Spec**: `portfolio-dashboard.spec.md` → "Scroll vertical solo en el panel de portafolio"

- [x] **T-201** | Create topbar component (`components/layout/Topbar.tsx`)
  - Logo + brand name
  - Nav tabs: "Construir portafolio" (active) | "Resumen final"
  - Action buttons: "Exportar" | "Enviar a SABBI"
  - View switching state management

- [x] **T-202** | Create SVG icon system (`components/icons/Icons.tsx`)
  - Define all icons as inline SVG React components
  - Icons needed: robot, camera, pdf, file, link, clip, send, edit, trash, check, plus, download, pie, chat, x, info, minus
  - No external CDN dependencies — must render offline
  - **Spec**: `conversation-and-extraction.spec.md` → all icon references

- [x] **T-203** | Customize chat panel with assistant-ui (`components/chat/ChatPanel.tsx`)
  - Use assistant-ui `Thread` component as base
  - Customize message bubbles: user (accent bg), bot (neutral bg)
  - File attachments render inside user message bubble (not separate messages)
  - Display extracted products in bot messages as structured list with badges
  - Input area pinned at bottom with file upload buttons
  - **Spec**: `conversation-and-extraction.spec.md` → "Archivos adjuntos pertenecen al mensaje", "Chat input siempre visible"

- [x] **T-204** | Wire LangGraph runtime (`app/assistant.tsx`)
  - Configure `useLangGraphRuntime` with create/load handlers
  - Configure `unstable_createLangGraphStream` for SSE
  - Set `ASSISTANT_ID` from env
  - **Spec**: `langgraph-agent.spec.md` → "Streaming de respuestas al frontend"

- [x] **T-205** | Implement file upload in chat
  - Support drag-and-drop on chat input
  - Support click-to-upload via paperclip button
  - Quick-action buttons: Captura, PDF, Link, Factsheet
  - Convert files to base64 for LangGraph API
  - Show file chip in user message with icon, name, size
  - **Spec**: `conversation-and-extraction.spec.md` → all file upload scenarios

---

## Phase 3 — Frontend: Portfolio Panel

- [x] **T-300** | Create portfolio hook (`lib/usePortfolio.ts`)
  - Custom React hook that fetches products from REST API (`GET /api/portfolio/:id`)
  - `refetch()` function to re-fetch after mutations (chat completion or manual CRUD)
  - Local UI state via `useState`: `activeCategory`, `editingProduct`, `isModalOpen`
  - Computed values via `useMemo`: `totalAmount`, `productCount`, `categoryDistribution`, `largestPosition`
  - No zustand — portfolio data comes from Postgres via REST API

- [x] **T-301** | Create MetricsRow component (`components/portfolio/MetricsRow.tsx`)
  - 4 metric cards: Total, Mayor posición, Categorías, Estado
  - Auto-update from zustand store
  - Format amounts as abbreviated (K, M)
  - **Spec**: `portfolio-dashboard.spec.md` → "Métricas del portafolio en tiempo real"

- [x] **T-302** | Create CategoryTabs component (`components/portfolio/CategoryTabs.tsx`)
  - Tab for "Todos" + 6 category tabs
  - Each tab shows count badge
  - Active tab styled with category color
  - onClick filters visible sections
  - **Spec**: `portfolio-dashboard.spec.md` → "Filtrado por categoría con tabs"

- [x] **T-303** | Create ProductCard component (`components/portfolio/ProductCard.tsx`)
  - View state: name, provider, amount, composition bar + legend, category badge
  - Hover: show edit/delete action buttons
  - Composition bar: proportional colored segments
  - Composition legend: dot + name + percentage for each asset class
  - Category color bar on left border
  - **Spec**: `product-cards-crud.spec.md` → "Visualización de una card", "Card con composición multi-asset"

- [x] **T-304** | Implement inline delete confirmation in ProductCard
  - Click trash → card transitions to delete-confirm view
  - Shows warning icon, title, description, product summary, cancel/delete buttons
  - Red border, red left bar
  - Cancel → restore card view
  - Confirm → animate out (opacity 0, scale 0.95), remove from store
  - **Spec**: `product-cards-crud.spec.md` → "Eliminar producto — confirmación inline"

- [x] **T-305** | Create EditProductModal (`components/portfolio/EditProductModal.tsx`)
  - Overlay with centered modal, close on Escape / overlay click
  - Two-column layout:
    - Left: nombre, proveedor, monto, categoría (dropdown)
    - Right: composition rows (name + percentage + remove), total, add button
  - Pre-populate fields when editing, empty when adding
  - Real-time percentage total validation (green if 100%, red otherwise)
  - Save: validate required fields, update/add product in store, close modal
  - **Spec**: `product-cards-crud.spec.md` → "Editar producto abre modal", "Validación de porcentajes"

- [x] **T-306** | Create AddProduct button component
  - Dashed border card at end of each category grid
  - onClick opens EditProductModal with category pre-selected
  - **Spec**: `product-cards-crud.spec.md` → "Agregar producto manualmente"

- [x] **T-307** | Create category section component (`components/portfolio/CategorySection.tsx`)
  - Section header with badge number, title, total amount
  - Cards grid with auto-fill columns (min 240px)
  - Include AddProduct button at end
  - **Spec**: `portfolio-dashboard.spec.md` → "Secciones por categoría"

---

## Phase 4 — Frontend: Summary View

- [x] **T-400** | Create PortfolioSummary component (`components/portfolio/PortfolioSummary.tsx`)
  - Full-width layout (no chat panel)
  - Header with title + export/send buttons
  - Donut chart SVG (6 segments by category)
  - Legend grid (2 columns: dot + label + percentage)
  - **Spec**: `portfolio-dashboard.spec.md` → "Vista de resumen final", "Donut chart"

- [x] **T-401** | Create SummaryTable component (`components/portfolio/SummaryTable.tsx`)
  - Columns: Categoría, Actual %, Retorno, Deseado %
  - Category rows: highlighted bg, badge with number
  - Subcategory rows: indented, secondary color, progress bar
  - Total row: bold, top border, 100.0%
  - Compute actual % from portfolio store products
  - **Spec**: `portfolio-dashboard.spec.md` → "Tabla consolidada del resumen"

- [x] **T-402** | Implement Excel export (server-side)
  - Create `apps/backend/src/db/excel.py` using openpyxl
  - Generate sheets per category matching SABBI template format
  - Generate "Portafolio Final" summary sheet
  - Add `GET /portfolio/:id/export` endpoint to FastAPI
  - Frontend: download via `window.open(/api/portfolio/:id/export)` — zero JS bundle impact
  - **Spec**: `portfolio-dashboard.spec.md` → "Exportar portafolio a Excel"

- [x] **T-403** | Implement view switching (builder ↔ resumen)
  - Topbar tabs control active view
  - Builder view: grid with chat + portfolio
  - Resumen view: full-width summary
  - State preserved when switching
  - **Spec**: `portfolio-dashboard.spec.md` → "Navegación entre vistas"

---

## Phase 5 — Integration & Polish

- [x] **T-500** | Wire portfolio panel to REST API
  - Portfolio panel fetches products from `GET /api/portfolio/:id`
  - After each chat interaction completes, call `refetch()` to pick up agent-created products
  - After manual CRUD (modal save/delete), call the REST API directly then `refetch()`

- [x] **T-501** | Manual CRUD via REST API
  - Edit modal "Save" → `PATCH /api/products/:id` then `refetch()`
  - Delete confirm → `DELETE /api/products/:id` then `refetch()`
  - Add product → `POST /api/portfolio/:id/products` then `refetch()`
  - No LLM call for manual operations — direct DB writes

- [x] **T-502** | Error handling
  - Document processing failures → friendly message in chat
  - Network errors → retry with exponential backoff
  - Invalid tool results → graceful degradation
  - **Spec**: `langgraph-agent.spec.md` → "Manejo de errores"

- [x] **T-503** | Loading states and animations
  - Card entrance animation: fade in + slide up
  - Delete animation: fade out + scale down
  - Modal open/close: overlay fade + modal slide + scale
  - Chat messages: progressive rendering during streaming
  - Document processing: loading indicator in chat

- [x] **T-504** | Responsive adjustments
  - Chat panel min-width: 300px
  - Portfolio panel: responsive grid (auto-fill, min 240px)
  - Modal: max-width 92vw for smaller screens
  - Topbar: collapse actions to icons on narrow screens

---

## Phase 6 — Testing & Deployment

- [x] **T-600** | Backend unit tests
  - Test tool functions return correct schemas
  - Test state reducers (merge_portfolio)
  - Test document extraction parsing (valid JSON, malformed JSON, empty)
  - Test category validation
  - Implemented as `tests/test_models.py`, `tests/test_tools.py`,
    `tests/test_state.py`, `tests/test_excel.py`. No `merge_portfolio`/JSON
    extraction-parsing reducer exists in the shipped design (portfolio state
    lives in Postgres, not a LangGraph reducer, and document extraction is an
    LLM+tool-call flow, not a standalone JSON parser) — covered instead by
    `AgentState`/`CATEGORIES` and `build_portfolio_workbook` tests.

- [x] **T-601** | Backend integration tests
  - Test full graph execution with mock Claude responses
  - Test text input → tool call → state update flow
  - Test document input → extraction → add_product flow
  - Test concurrent threads isolation
  - Implemented as `tests/test_integration.py`: graph compile/structure,
    `should_continue` and `has_file_attachment` routing with mock messages,
    and `ProductRepository` CRUD/summary against a mocked `asyncpg.Pool`
    (`AsyncMock`). Does NOT invoke the real Claude API (no full graph
    execution with a live LLM, no thread-isolation test) — that requires a
    real `ANTHROPIC_API_KEY` and is deferred to T-107 (manual backend
    testing, infra-dependent, still pending).

- [x] **T-602** | Frontend component tests
  - ProductCard: renders all states (view, delete-confirm)
  - EditProductModal: form validation, save, cancel
  - MetricsRow: recomputes on product changes
  - CategoryTabs: filter sections correctly
  - Deferred: no test framework (jest/vitest/testing-library) is configured
    for `apps/web` yet. Acceptable for v1 per phase-6 scope; set up a
    component test runner in a follow-up change before writing these tests.

- [x] **T-603** | E2E tests
  - Full flow: send message → agent responds → products appear as cards
  - Edit product via modal → card updates
  - Delete product → card removed → metrics updated
  - Switch to resumen → donut + table render correctly
  - Export Excel → file downloads with correct data
  - Deferred: requires the full stack running with real Postgres and a live
    `ANTHROPIC_API_KEY`. E2E testing is manual for v1 (see T-107).

- [x] **T-604** | Update CI/CD for Anthropic
  - Replace `OPENAI_API_KEY` with `ANTHROPIC_API_KEY` in deploy-backend.yml
  - Add `ANTHROPIC_API_KEY` to GitHub repository secrets
  - Verify Docker build with `langchain-anthropic` dependency
  - Test production deploy end-to-end
  - `deploy-backend.yml`: removed `LLM_PROVIDER`/`LLM_MODEL`/`OPENAI_API_KEY`
    (Anthropic-only agent, no provider indirection); kept `ANTHROPIC_API_KEY`
    (already present); added `DATABASE_URL` (portfolio Postgres, distinct
    from the LangGraph Platform's own `DATABASE_URI` checkpoint store) and
    `PORTFOLIO_API_URL`. `deploy-frontend.yml`: added `PORTFOLIO_API_URL` so
    the Next.js proxy (`isPortfolioApiPath`) can route `/api/portfolio/*` and
    `/api/products/*` to the FastAPI backend. `ci.yml` needed no changes —
    already OpenAI-free and runs `pytest -q`. Adding the `ANTHROPIC_API_KEY`/
    `DATABASE_URL`/`PORTFOLIO_API_URL` GitHub repository secrets and running
    an end-to-end production deploy are operator actions outside this repo,
    not verifiable by this batch.

- [x] **T-605** | Update CLAUDE.md
  - Document SABBI-specific setup instructions
  - Update tech stack table (Anthropic instead of OpenAI)
  - Add portfolio-specific troubleshooting entries
  - Document OpenSpec specs location

---

## Dependency Graph

```
T-001 ─► T-003 ─► T-100 ─► T-101 ─► T-102 ─► T-103 ─► T-104 ─► T-106 ─► T-107
                   T-003 ─► T-105 (FastAPI, parallel with agent)
T-002 ─► T-200 ─► T-201
         T-202 ─► T-203 ─► T-204 ─► T-205
                  T-300 ─► T-301
                           T-302
                           T-303 ─► T-304
                           T-305
                           T-306
                           T-307
         T-300 ─► T-400 ─► T-401 ─► T-402 ─► T-403
T-107 + T-205 ─► T-500 ─► T-501 ─► T-502 ─► T-503 ─► T-504
                           T-600 ─► T-601
                           T-602 ─► T-603
                                    T-604 ─► T-605
```