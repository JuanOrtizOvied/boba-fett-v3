# SABBI Frontend -- Documentation

## Overview

SABBI (Sistema de Asesoría de Portafolio) is an AI-assisted investment portfolio builder. The frontend is a **Next.js 15** application using **React 19**, **Tailwind CSS v4**, and **assistant-ui** for the conversational interface. It presents a split-screen layout: a chat panel on the left where users interact with a LangGraph-powered AI agent, and a portfolio dashboard on the right that displays the user's investment products organized by category.

### Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js | 15.x |
| UI Library | React | 19.x |
| Styling | Tailwind CSS | 4.x |
| Chat Runtime | @assistant-ui/react custom external-store runtime | 0.14.x |
| Markdown | @assistant-ui/react-markdown, remark-gfm | 0.14.x / 4.x |
| LangGraph SDK | @langchain/langgraph-sdk | 1.9.x (legacy/helper only, not the main chat runtime) |
| Testing | Vitest, @testing-library/react, jsdom | 4.x / 16.x |
| Build Output | Standalone (Docker/PM2) | -- |

### Architecture

```
Browser
  |
  |-- Next.js (SSR + Client Components)
  |     |
  |     |-- /api/[...path] (catch-all proxy route)
  |           |
  |           |-- /auth/*, /portfolio/*, /products/*, /admin/*, /chat/*
  |           |     --> FastAPI backend (:3003 dev / PORTFOLIO_API_URL prod)
  |           |
  |           |-- /threads/*, /runs/*, everything else
  |                 --> LangGraph backend (:2024 dev / LANGGRAPH_API_URL prod)
  |
  PostgreSQL (shared products table, auth, checkpoints)
```

All backend communication flows through the Next.js API proxy route, which injects server-side credentials and routes requests to the appropriate upstream service.

---

## Pages & Routes

### `/login` -- Login Page

**File:** `app/login/page.tsx`

Split-screen login page with a branded hero panel (SABBI green, `#2B3C2B`) on the left showing category breakdowns, and an email/password form on the right. On successful login, admins are redirected to `/admin`, regular users to `/`.

- Calls `POST /api/auth/login` via the `AuthProvider.login()` method
- Displays inline error messages with a shake animation (`animate-login-error`)
- Responsive: hero panel collapses to 30vh on mobile
- Shows a loading spinner on the submit button while authenticating

### `/` -- Main App (Portfolio Builder)

**File:** `app/page.tsx`

The primary authenticated view. Uses a `PortfolioView` state (`"builder"` | `"resumen"`) controlled by the `Topbar` to switch between:

- **Builder view** (`grid-cols-[40%_1fr]`): `MyAssistant` (chat) on the left, `PortfolioPanel` (dashboard) on the right
- **Resumen view**: Full-width `PortfolioSummary` with a donut chart and consolidated table

Protected by `middleware.ts` -- unauthenticated users are redirected to `/login`.

### `/admin` -- Admin Panel

**Files:** `app/admin/layout.tsx`, `app/admin/page.tsx`

Admin-only section with a sidebar layout. The layout component (`AdminLayout`) performs a client-side role check -- non-admin users are redirected to `/`. Contains six sub-pages:

| Route | File | Description |
|---|---|---|
| `/admin` | `app/admin/page.tsx` | User directory -- lists all users with email, role, creation date |
| `/admin/users/create` | `app/admin/users/create/page.tsx` | User creation form (email, password, role selector) |
| `/admin/portfolios` | `app/admin/portfolios/page.tsx` | All portfolios overview with product count and totals |
| `/admin/portfolios/[userId]` | `app/admin/portfolios/[userId]/page.tsx` | Read-only view of a single user's portfolio, with a per-card "Aprobar al catálogo" affordance (no edit/delete) |
| `/admin/catalog` | `app/admin/catalog/page.tsx` | Product catalog entries listing -- sticky-header table with inline edit/delete per entry |
| `/admin/threads` | `app/admin/threads/page.tsx` | Thread directory across all users, with per-thread cost column |
| `/admin/threads/[threadId]` | `app/admin/threads/[threadId]/page.tsx` | Read-only message history for a single thread, with per-message and aggregate cost tracking |

Admin sidebar navigation links (`NAV_LINKS` in `app/admin/layout.tsx`):

- Usuarios (user list)
- Crear usuario (user creation form)
- Portafolios (portfolio overview)
- Catálogo (catalog entries listing)
- Chats (thread directory)
- Volver al portafolio (link back to `/`, outside `NAV_LINKS`)
- Cerrar sesion (logout, outside `NAV_LINKS`)

See [Admin Catalog Approval](#admin-catalog-approval) below for the full `/admin/catalog` and approval-modal workflow.

### `/api/[...path]` -- API Proxy Route

**File:** `app/api/[...path]/route.ts`

Catch-all Next.js API route that proxies all frontend API calls to the appropriate backend. Exports handlers for `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`.

**Routing logic** (`isFastApiPath` function):

| Path prefix | Upstream |
|---|---|
| `/portfolio/*` | FastAPI (`PORTFOLIO_API_URL`, default `:3003`) |
| `/products/*` | FastAPI |
| `/auth/*` | FastAPI |
| `/admin/*` | FastAPI |
| `/chat/*` | FastAPI |
| Everything else (`/threads/*`, `/runs/*`) | LangGraph (`LANGGRAPH_API_URL`, default `:2024`) |

**Key behaviors:**

- Injects `x-api-key` header for LangGraph requests (from `LANGCHAIN_API_KEY` env var)
- Forwards `Set-Cookie` headers individually using `getSetCookie()` to preserve multiple cookies (critical for `sabbi_access` + `sabbi_refresh` during login)
- Uses `duplex: "half"` for streaming request bodies
- Returns a `502` JSON error if the upstream is unreachable

**Environment variables:**

```
LANGGRAPH_API_URL    (default: http://localhost:2024)
LANGCHAIN_API_KEY    (optional, injected for LangGraph requests)
PORTFOLIO_API_URL    (default: http://localhost:3003)
```

The main chat UI uses the FastAPI SSE route under `/api/chat/*`, so local chat requires `PORTFOLIO_API_URL` to point at the FastAPI service. `NEXT_PUBLIC_LANGGRAPH_API_URL` is not required for the current chat runtime.

---

## Authentication

### Auth Flow

**Files:** `components/auth/AuthProvider.tsx`, `lib/fetchWithAuth.ts`, `middleware.ts`

SABBI uses **httpOnly cookie-based authentication** with access + refresh token rotation:

1. **Login:** `POST /api/auth/login` with `{ email, password }`. The backend sets two httpOnly cookies: `sabbi_access` (short-lived JWT) and `sabbi_refresh` (long-lived).
2. **Identity resolution:** On mount, `AuthProvider` calls `GET /api/auth/me` via `fetchWithAuth` to resolve the current user from the opaque `sabbi_access` cookie.
3. **Token refresh:** When any authenticated request returns `401`, `fetchWithAuth` calls `POST /api/auth/refresh` once (deduplicated with a shared promise). If the refresh succeeds, the original request is retried.
4. **Logout:** `POST /api/auth/logout` clears the cookies. Client-side `user` is set to `null`.

### AuthProvider

**File:** `components/auth/AuthProvider.tsx`

React context provider mounted at the root layout. Exposes:

```typescript
interface AuthContextValue {
  user: AuthUser | null;       // { id, email, role, active_thread_id }
  isLoading: boolean;          // true while initial /auth/me is in flight
  isAuthenticated: boolean;    // user != null
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}
```

The `useAuth()` hook provides access from any component. Throws if used outside `AuthProvider`.

### AuthUser Type

```typescript
interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
  active_thread_id: string | null;
}
```

### fetchWithAuth

**File:** `lib/fetchWithAuth.ts`

A `fetch` wrapper that transparently handles `401` responses:

1. Performs the request normally
2. If `401`, calls `POST /api/auth/refresh` (deduplicated -- concurrent 401s share one refresh call)
3. If refresh succeeds, retries the original request
4. If refresh fails, returns the original 401 response

### Middleware

**File:** `middleware.ts`

Server-side route guard that runs on every request (except `_next/static`, `_next/image`, `favicon.ico`):

- **Public paths:** `/login` -- always allowed
- **API paths:** `/api/*` -- always allowed (the proxy handles its own auth)
- **Protected paths:** Everything else -- redirects to `/login` when BOTH `sabbi_access` and `sabbi_refresh` cookies are absent

When only `sabbi_access` is missing but `sabbi_refresh` exists, the page loads normally and `fetchWithAuth` handles the refresh client-side.

### Role-Based Access

| Role | Access |
|---|---|
| `user` | `/`, `/login` |
| `admin` | `/`, `/login`, `/admin/*` |

The middleware checks cookie existence only (it does not decode the JWT). The admin role check is performed client-side in `app/admin/layout.tsx` using `useAuth()`.

---

## Chat (Assistant)

### Architecture

**Files:** `app/assistant.tsx`, `components/chat/ChatPanel.tsx`, `components/assistant-ui/thread.tsx`, `components/chat/ThinkingPanel.tsx`

The chat system uses a custom `useExternalStoreRuntime` from `@assistant-ui/react` instead of a direct LangGraph SDK runtime adapter. This gives full control over SSE streaming, message conversion, and the thinking/progress UI.

```
MyAssistant (app/assistant.tsx)
  |-- ThinkingProvider (context for progress steps + reasoning)
  |-- AssistantInner
        |-- useExternalStoreRuntime (custom store)
        |-- AssistantRuntimeProvider
              |-- ChatPanel (components/chat/ChatPanel.tsx, receives userEmail prop)
                    |-- HistoryLoader (shown while loading history)
                    |-- Thread (components/assistant-ui/thread.tsx)
                          |-- ThreadPrimitive.Viewport
                          |     |-- WelcomeMessage (empty state)
                          |     |-- Messages (UserMessage / AssistantMessage)
                          |     |-- ThinkingPanel
                          |-- Composer (input + attachments + send/cancel)
```

### User Email in Chat Header

**Files:** `components/chat/ChatPanel.tsx`, `app/assistant.tsx`

`ChatPanel` accepts an optional `userEmail` prop. When provided, it is displayed right-aligned in the chat header bar, next to the "Asistente SABBI / En linea" label. The email is truncated with the `truncate` CSS class and shows the full address in a `title` attribute on hover.

`MyAssistant` in `app/assistant.tsx` passes `user?.email` from `useAuth()` to `ChatPanel` as the `userEmail` prop.

### Message Streaming (SSE)

**File:** `app/assistant.tsx`

Messages are streamed via Server-Sent Events from the backend endpoint `POST /api/chat/threads/:threadId/messages/stream`.

**Request payload:**

```json
{
  "message": "string",
  "attachments": [{ "type": "file", "data": "base64", "mime_type": "...", "metadata": { "filename": "..." } }]
}
```

**SSE event types:**

| Event | Data Shape | Purpose |
|---|---|---|
| `progress` | `{ step: string, label: string }` | Updates the ThinkingPanel with a new progress step |
| `reasoning` | `{ content: string }` | Appends to the reasoning/thinking text (streamed incrementally) |
| `text` | `{ content: string }` | Appends to the assistant's visible response (streamed incrementally) |
| `final` | `ThreadStateResponse` | Complete thread state with all messages -- replaces the streamed placeholder |
| `done` | any | Signals stream completion |
| `error` | `{ detail: string }` | Error message -- displayed as a toast and inline in the message |

The `parseSseStream` async generator handles chunked SSE parsing with proper buffer management.

### Thread Management

**File:** `app/assistant.tsx`

- **Thread creation:** On first load, if the user has no `active_thread_id`, a new UUID is generated and saved via `PUT /api/auth/me/thread`
- **Thread loading:** On mount, `fetchThreadState(threadId)` calls `GET /api/chat/threads/:threadId/state` to load the message history
- **Message conversion:** `convertMessages()` transforms backend `ApiMessage[]` (LangChain format with `type: "human"/"ai"/"tool"`) into `ThreadMessageLike[]` for the assistant-ui runtime, including:
  - Text content blocks
  - Image content blocks (base64 data URLs)
  - File/document content blocks
  - Tool calls with their results (matched by `tool_call_id`)

### File Attachments

**File:** `components/assistant-ui/thread.tsx`

The `Base64DocumentAttachmentAdapter` handles file uploads:

1. **Add:** Creates a `PendingAttachment` with `status: "requires-action"` (deferred until send)
2. **Send:** Reads the file as a base64 data URL using `FileReader.readAsDataURL()`, strips the prefix, and returns a `CompleteAttachment` with `content: [{ type: "file", filename, data, mimeType }]`
3. **Remove:** No-op (files only exist client-side until sent)

**Supported file types:** All files (`accept = "*"`). The adapter handles PDFs, images, spreadsheets, and any binary document.

**UI rendering of attachments in messages:**

- **Images:** Rendered inline as `<img>` tags with max height 48rem
- **PDFs:** Rendered as an `<iframe>` preview (144px height) with "Descargar" and "Abrir" buttons
- **Other files:** Rendered as a compact chip with icon, filename, and type badge

Base64 data is converted to blob URLs via `base64ToBlobUrl()` for preview/download functionality.

### Thinking/Progress Indicators

**File:** `components/chat/ThinkingPanel.tsx`

The `ThinkingProvider` context manages:

```typescript
interface ThinkingState {
  steps: ProgressStep[];    // { step, label, completed }
  reasoning: string;        // Accumulated reasoning text
  visible: boolean;         // Whether to show the panel
}
```

The `ThinkingPanel` component displays:

- A collapsible step progress indicator (current step with animated dot, completed count)
- Expandable list of all steps with checkmarks/pulse indicators
- Collapsible reasoning text section

Steps are updated by `progress` SSE events; reasoning by `reasoning` SSE events. All steps are marked complete when a `final` event arrives.

### Tool Call Rendering

**File:** `components/assistant-ui/thread.tsx`

The `AssistantMessage` component maps tool calls to custom renderers by name:

```typescript
tools: {
  by_name: {
    propose_product: ProposeProductCard,   // Interactive proposal card
    add_product: ToolResultItem,           // Inline result row
    update_product: ToolResultItem,        // Inline result row
    delete_product: ToolResultItem,        // Inline result row
  },
  Fallback: () => null,  // Silently ignore unknown tools
}
```

#### ProposeProductCard

An interactive card rendered when the agent calls `propose_product`. Features:

- **Header:** Category badge + "Producto encontrado" label + reliability badge (Catalogo SABBI, Busqueda web, No verificado)
- **Editable fields** (while pending): Name, Provider, Amount (USD), Category (dropdown)
- **Composición subyacente:** Multi-row composition editor -- a grouped dropdown (optgroups from `CATEGORY_SUBCATEGORIES`, sourced from the product's category) adds a row per selection; each row has a percentage input and a remove button. Rows must sum to 100% (`isCompValid`). This is the same UX pattern as `EditProductModal`'s composition editor -- there is no standalone subcategory field or dropdown anymore.
- **Enriched fields** (read-only): Commission, Currency, Administrator, Manager, Liquidity, Return rate -- with field-level source markers (globe emoji for web_search, robot emoji for claude_knowledge)
- **Catalog match:** When `product.catalog_product_id` is present (the agent matched an existing catalog entry), it is echoed back in the confirm payload so the backend can link the created product to that catalog row
- **Missing fields warning:** Amber text listing incomplete required fields (nombre, monto, composición)
- **Action buttons:** "Si, agregar" (disabled when invalid) and "No" (always enabled)
- **Confirmed/Rejected state:** Replaces buttons with a status label

On confirm, the card sends a structured user message: `"Sí, agregar al portafolio con: nombre: X, monto: Y, categoría: Z, underlying: [Leaf: P%, ...]."` (plus `proveedor: ...` and `catalog_product_id: ...` when present) which the agent parses to call `add_product`.

#### ProposalBatchProvider and BulkAcceptBar

**Context:** `ProposalBatchContext` tracks all `ProposeProductCard` instances mounted within a single assistant message.

**BulkAcceptBar** appears when 2+ proposals are pending. Shows `"X de Y productos listos"` with an "Agregar todos" button that:

- Is disabled if any pending card has missing required fields
- Sends one combined message: `"Sí, agregar todos al portafolio:\nnombre: A, monto: ..., underlying: [...]\nnombre: B, monto: ..., underlying: [...]"`
- Marks all cards as confirmed simultaneously

The batch uses a module-level `_globalRespondedIds` set that survives React re-renders/remounts.

#### ToolResultItem (add/update/delete)

Inline result rows for portfolio mutation tool calls. Uses CSS adjacency selectors (`.tool-result-item + .tool-result-item`) to visually merge consecutive rows into a single card:

- **Added/Updated:** Category badge + product name + formatted amount
- **Deleted:** Red "Eliminado" badge + product ID
- **Error results:** Silently hidden (`return null`)

#### UserTextPart (Confirmation Messages)

The `UserTextPart` component detects structured confirmation messages and renders them as formatted tables:

- Bulk: `"Si, agregar todos al portafolio:\n..."` -- parsed into a `PortfolioConfirmTable`
- Single: `"Si, agregar al portafolio con: ..."` -- parsed into a single-row table

Each row shows a category badge, product name, and formatted amount.

---

## Portfolio Dashboard

### PortfolioPanel

**File:** `components/portfolio/PortfolioPanel.tsx`

The right-side panel of the builder view. Layout:

```
PortfolioPanel
  |-- [Loading state] Spinner + "Cargando portafolio..."
  |-- [Empty state] PieIcon + instructions + "Agregar producto manualmente" + SnapshotButton
  |-- [Data state]
        |-- Fixed header (shrink-0, border-b)
        |     |-- Total amount (abbreviated USD) + product count
        |     |-- Largest position (percentage + product name)
        |     |-- SnapshotButton ("Guardar versión")
        |     |-- "Ver versiones" button (opens VersioningDrawer, shows snapshot count badge)
        |     |-- CategoryTabs
        |-- Scrollable body (flex-1, overflow-y-auto)
              |-- CategorySection (per visible category)
              |-- EditProductModal (overlay)
              |-- VersioningDrawer (right-side slide-over)
```

Uses the `usePortfolio()` hook for data and `usePortfolioVersioning()` for snapshots/comparison/change-log state. Product deletion calls `DELETE /api/products/:id` directly. See [Portfolio Versioning](#portfolio-versioning) below for the snapshot/change-log/comparison feature set.

### MetricsRow (unused)

**File:** `components/portfolio/MetricsRow.tsx`

A four-card metric grid (`grid-cols-2 lg:grid-cols-4`: Total, Mayor posición, Categorías, Estado) with `animate-metric-flash` highlight-on-change. It is **not imported anywhere** -- `PortfolioPanel` was reworked to show total amount, product count, and largest position inline in its fixed header (alongside the versioning controls) instead of mounting this component. Kept in the tree as dead code; treat it as legacy reference, not the active metrics UI.

### CategoryTabs

**File:** `components/portfolio/CategoryTabs.tsx`

Horizontal pill-style tabs for filtering visible categories. Uses `role="tablist"` for accessibility.

- **"Todos"** tab: Shows all categories, active by default
- **Per-category tabs:** One per category in `CATEGORY_ORDER`, with count badges and category-specific accent colors (via `color-mix()`)

Active tab styling uses the category's accent color for border, background tint, and text.

### CategorySection

**File:** `components/portfolio/CategorySection.tsx`

Per-category section with:

- **Header:** Numbered badge (colored circle) + category label + total USD amount
- **Product grid:** `grid-cols-[repeat(auto-fill,minmax(240px,1fr))]` containing `ProductCard` components
- **AddProductButton:** Dashed-border card at the end of each grid

### ProductCard

**File:** `components/portfolio/ProductCard.tsx`

Product card with two mutually exclusive states:

**View state:**

- Product name and provider line
- Formatted USD amount (DM Sans display font)
- Composition bar (horizontal stacked bar chart, built from `product.underlying`) with legend dots showing asset name + percentage
- Category badge (colored pill)
- Hover-revealed edit/delete icon buttons (opacity transition)
- Left colored border strip matching the category color

Special handling: When `product.underlying` has a single entry at ~100% with the same name as the product, the legend shows that single entry's name instead of duplicating the product name as both title and legend.

**Confirm-delete state** (inline, no separate dialog):

- Red border, warning icon, confirmation text
- Product name and amount preview
- Cancel and Delete buttons (with loading state)
- Delete error message display
- 300ms fade-out animation before removal

**New product highlight:** Cards with IDs in `newProductIds` get `animate-product-added` (entry slide + green pulse ring, 2s duration) and auto-scroll into view after 350ms.

### AddProductButton

**File:** `components/portfolio/AddProductButton.tsx`

Dashed-border placeholder card (`min-h-[140px]`) with a plus icon and "Agregar producto" label. Opens the `EditProductModal` pre-scoped to the parent category. Hover state uses lime green accent.

### EditProductModal

**File:** `components/portfolio/EditProductModal.tsx`

Two-column overlay modal for creating and editing products. Closes on Escape key or overlay click.

**Left column -- Product data:**

- Name (text input, required)
- Provider (text input)
- Amount in USD (number input, required, must be > 0)
- Category (dropdown from `CATEGORY_ORDER`)

**Right column -- Composición por subcategoría:**

- A grouped dropdown ("Agregar subcategoría...") sourced from `CATEGORY_SUBCATEGORIES[category]` -- selecting a leaf adds a composition row for it and removes it from the dropdown so it can't be added twice
- Each row shows the selected subcategory name (read-only), a percentage input, and a remove button
- Real-time percentage total indicator (green when within 0.5 of 100%, red otherwise)
- Changing the Category dropdown resets the composition rows, since the subcategory options are category-scoped

**Validation:** Name, amount > 0, and at least one composition entry summing to ~100% are required before save.

**API calls:**

- **Create:** `POST /api/portfolio/me/products` with `{ name, provider, amount, category, underlying }`
- **Edit:** `PATCH /api/products/:id` with the same payload

Shows inline form errors and toast notifications on failure.

### PortfolioSummary

**File:** `components/portfolio/PortfolioSummary.tsx`

Full-width "Resumen final" view equivalent to the "Portafolio Final" Excel sheet. Contains:

- **Header:** Title and description
- **Donut chart:** Pure SVG, 220x220px, 28px stroke width. Segments are drawn as stacked circles with `strokeDasharray`/`strokeDashoffset`. Center shows abbreviated total amount and product count.
- **Legend:** 2-column grid with colored dots, category labels, and percentages
- **SummaryTable:** Consolidated breakdown table

Uses its own `usePortfolio()` call (independent from the builder view) for data isolation.

### SummaryTable

**File:** `components/portfolio/SummaryTable.tsx`

Four-column table (`Categoria`, `Actual %`, `Retorno`, `Deseado %`):

- **Category rows** (highlighted bg): Numbered badge + label + actual % of total portfolio
- **Product rows** (indented): Product name + mini progress bar (relative to category total) + actual %
- **Total footer row:** Bold, sums to 100.0%
- **Retorno and Deseado %:** Currently render "--" (deferred scope -- no return/target data model exists)

---

## Admin Catalog Approval

An admin-only workflow that lets admins promote a product from an investor's portfolio into the shared **product catalog** (`product_catalog` table), enriching it with fields the catalog needs (asset class, geographic focus, commission, currency, administrator, manager, liquidity, return rate) that a raw portfolio product doesn't carry.

### Catalog Listing -- `/admin/catalog`

**File:** `app/admin/catalog/page.tsx`

Fetches `GET /api/admin/catalog/entries` and renders a sticky-header, horizontally scrollable table (`CATALOG_COLUMNS`): Categoría, Nombres alternativos, Clase de activo, Foco geográfico, Subyacente, Comisión, Moneda, Administrador, Gestor, Rendimiento. Name and the Opciones (edit/delete) column are sticky-left/right respectively.

- **Edit:** Opens `EditCatalogModal` (defined in the same file), a two-column form covering all `EDITABLE_FIELDS`. `alternative_names` and `underlying` are edited as newline-delimited textareas (`Name: percentage%` syntax for `underlying`) and parsed back into arrays/objects on save. Only changed fields are sent in the `PATCH /api/admin/catalog/entries/:id` payload.
- **Delete:** Confirmation dialog (`ConfirmDeleteDialog`) -- on confirm, calls `DELETE /api/admin/catalog/entries/:id`, plays a 400ms `animate-row-delete` fade before removing the row from local state.

### Approve-to-Catalog Affordance -- `/admin/portfolios/[userId]`

**File:** `app/admin/portfolios/[userId]/ReadOnlyProductCard.tsx`

**`ReadOnlyProductCard`** visually mirrors `ProductCard`'s view state (name, provider, amount, composition bar) but drops all edit/delete affordances and instead has a single full-width "Aprobar al catálogo" button at the bottom. Implemented as a page-scoped component (not a variant of the shared `ProductCard`) so the mutable portfolio-builder component's contract stays unchanged. When the product has already been approved (its ID appears in `approved_from_product_id` on some catalog entry), the card gets an emerald border, `animate-product-added`, and the button becomes a disabled "Aprobado" state.

**`ApproveProductModal`** (same file) opens when a card's "Aprobar al catálogo" button is clicked:

- Pre-fills `name`/`category` from the source product; every enrichment field (asset class, geographic focus, commission, currency, administrator, manager, liquidity, return rate) starts empty for the admin to fill in
- **Comparison mode:** If the product already matches a catalog entry (`product.catalog_product_id`), the modal switches to a per-field `ComparisonRow` layout instead of plain inputs -- each row shows the **editable new value on the left** and the **read-only current catalog value on the right** ("Valor actual"), with an amber left border and a "Modificado" badge on any row where the trimmed values differ
- **New-entry mode:** If there's no existing catalog match, the modal renders a plain single-column form instead
- Confirm posts `POST /api/admin/catalog/approve` with `{ name, category, ...enrichment fields, approved_from_product_id, catalog_product_id }`. A `409` response ("Ya existe un producto igual en el catálogo") and other errors stay inline; success calls `onApproved(productId)` (marks the source card approved) and closes the modal.

### Wiring -- `app/admin/portfolios/[userId]/page.tsx`

On mount, fetches the portfolio, the admin user list (to resolve the owner's email), and `GET /api/admin/catalog/entries` in parallel. Catalog entries seed `approvedProductIds` (from each entry's `approved_from_product_id`) so already-approved cards render correctly on load, and are also used to resolve `approvingCatalogEntry` -- the matching catalog row (by `catalog_product_id`) passed into `ApproveProductModal` to trigger comparison mode.

---

## Admin Chat Cost Tracking

Cost estimation for AI chat threads, based on Anthropic model token pricing. Available in two admin views: the thread list (aggregate per thread) and the thread detail (per message + summary).

### Model Pricing Table

**Files:** `app/admin/threads/page.tsx`, `app/admin/threads/[threadId]/page.tsx`

Both files define a `MODEL_PRICING` constant with input and output rates per 1M tokens for the supported models:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| `claude-sonnet-4` | $3.00 | $15.00 |
| `claude-haiku-4.5` | $0.80 | $4.00 |
| `claude-opus-4` | $15.00 | $75.00 |

### Thread Detail -- Per-Message Cost

**File:** `app/admin/threads/[threadId]/page.tsx`

The `AdminThreadMessage` type includes `ResponseMetadata` and `MessageUsage` fields that carry the model identifier and token counts (input/output) for each AI response.

Utilities:

- `calcMessageCost(usage, model)` -- computes USD cost for a single message from its token counts and the model's pricing row
- `getModelLabel(model)` -- returns a human-readable model name for display badges
- `formatTokens(count)` -- formats token counts with locale separators

Each AI message bubble (`AssistantMessageBubble`) renders a footer showing:

- Model name badge (e.g. "Sonnet 4")
- Token count breakdown (input / output)
- Cost in USD (e.g. "$0.0042")

A **cost summary panel** renders at the top of the thread view via `computeCostSummary()`. It aggregates across all messages and shows:

- Total chat cost in USD
- Per-model breakdown: message count, total input/output tokens, and cost

The summary panel only renders when `costSummary.totalMessages > 0`.

### Thread List -- Cost Column

**File:** `app/admin/threads/page.tsx`

The `AdminThread` interface includes a `cost` field. After loading the thread list, the page fetches each thread's messages in parallel via `GET /api/admin/threads/{threadId}` and computes per-thread costs using `calcThreadCost()` (same pricing logic as the thread detail).

The table includes a "Costo" column that displays:

- `"..."` while cost data is loading
- `"$X.XXXX"` when computed
- `"--"` for threads with zero or null cost

---

## Portfolio Versioning

Change-tracking and point-in-time snapshots for a portfolio, plus side-by-side comparison between two snapshots. Backed by `db/versioning.py`'s `VersioningRepository` (`portfolio_changes` and `portfolio_snapshots` tables) on the FastAPI side.

### usePortfolioVersioning Hook

**File:** `lib/usePortfolioVersioning.ts`

Mirrors `usePortfolio.ts`'s conventions (`fetchWithAuth`, redirect to `/login` on `401`). Three independent slices, all mounted once from `PortfolioPanel`:

- **Snapshots:** `snapshots`, `isLoadingSnapshots`, `fetchSnapshots()`, `createSnapshot(name, description?)`, `hasChanges` (from `GET /api/portfolio/me/snapshots/has-changes` -- disables the "Guardar versión" button when the current portfolio is identical to the last snapshot; creating a snapshot of an empty portfolio is explicitly supported and never disabled)
- **Comparison:** `comparison`, `isComparing`, `compareError`, `compareSnapshots(aId, bId)`, `clearComparison()` -- calls `GET /api/portfolio/me/compare?a=:id&b=:id`; on failure, `comparison` is reset to `null` (never left stale) and `compareError` is set from the response's `{"detail": "..."}` body when present
- **Change log:** `changes`, `isLoadingChanges`, `changesTotal`, `changesHasMore`, `fetchChanges({ limit?, offset? })` -- calls `GET /api/portfolio/me/changes`, which returns `{ changes, total, has_more }` (paginated)

The change-log and `hasChanges` slices both re-fetch on the shared `sabbi:portfolio-refetch` window event (see [Portfolio Events](#portfolio-events)), so they stay fresh after every chat-triggered mutation without a dedicated event.

### Data Shapes

```typescript
interface Snapshot {
  id: string;
  name: string;
  description: string;
  product_count: number;
  total_amount: number;
  category_summary: { category: string; percentage: number }[];
  created_at: string;
}

interface SnapshotDetail extends Snapshot {
  products: Product[];
}

type ChangeOperation = "create" | "update" | "delete";
type ChangeSource = "agent" | "api" | "admin";

interface ChangeLogEntry {
  id: string;
  user_id: string;
  product_id: string | null;
  operation: ChangeOperation;
  before_state: Product | null;
  after_state: Product | null;
  source: ChangeSource;
  metadata: Record<string, unknown>;
  snapshot_id: string | null;
  created_at: string;
}

interface SnapshotDiff {
  snapshot_a: string;
  snapshot_b: string;
  added: Product[];
  removed: Product[];
  modified: {
    product_id: string;
    name: string;
    before: Product;
    after: Product;
    changes: Record<string, { before: unknown; after: unknown }>;
  }[];
  summary: {
    added_count: number;
    removed_count: number;
    modified_count: number;
    total_amount_delta: number;
    product_count_delta: number;
  };
}
```

### SnapshotButton and SnapshotModal

**Files:** `components/portfolio/SnapshotButton.tsx`, `components/portfolio/SnapshotModal.tsx`

`SnapshotButton` is a small "Guardar versión" button (camera icon) mounted in `PortfolioPanel`'s header and its empty state; disabled with a "Sin cambios respecto a la última versión" tooltip when `hasChanges` is false. Clicking it opens `SnapshotModal`, an overlay form (name required, description optional) following `EditProductModal`'s conventions (Escape/overlay-click to close, inline errors, toast on failure/success).

### VersioningDrawer

**File:** `components/portfolio/VersioningDrawer.tsx`

Right-side slide-over (`animate-drawer-panel`, 220ms) opened by PortfolioPanel's "Ver versiones" button. Two tabs (`role="tablist"`):

- **"Versiones"** -- renders `SnapshotList`
- **"Cambios"** -- renders `ChangeLog`

Owns the two-step "select two snapshots to compare" selection state and the read-only snapshot detail fetch (`GET /portfolio/me/snapshots/:id`, called directly via `fetchWithAuth`). All transient state (active tab, compare selection, detail view, open comparison) resets whenever the drawer closes.

### SnapshotList

**File:** `components/portfolio/SnapshotList.tsx`

Newest-first list of snapshot cards, each showing name, abbreviated total, a mini composition bar + legend (categories merged via `resolveCategoryKey` since a snapshot's stored `category_summary` may contain legacy keys), and a full date. Each card has a "Seleccionar para comparar" checkbox; once two are selected, a "Comparar versiones seleccionadas" button appears above the list. Clicking a card (not the checkbox) opens its read-only detail view (product list with amounts) in place of the list, with a "Volver a versiones" back link.

### ChangeLog

**File:** `components/portfolio/ChangeLog.tsx`

Paginated, reverse-chronological list of `portfolio_changes` rows. Each row shows an operation badge (Creado/Actualizado/Eliminado), the affected product's name, provider, category badge, a source icon + label (Agente/Manual/Admin), and a relative timestamp (`formatRelativeTime`). For `update` entries, `describeChanges()` diffs `before_state`/`after_state` inline (amount, category, name changes) as a compact italic summary line. A "Cargar más" button pages through results when `changesHasMore` is true.

### VersioningBar (unused)

**File:** `components/portfolio/VersioningBar.tsx`

A thin strip meant to sit between the metrics/category-tabs header and the scrollable body, showing snapshot count and a recent-activity indicator. Like `MetricsRow`, it is **not imported anywhere** -- `PortfolioPanel` surfaces the same information (snapshot count via the "Ver versiones" badge) directly in its header instead. Kept as dead code / legacy reference.

### ComparisonView

**File:** `components/portfolio/ComparisonView.tsx`

Full-width modal (`z-[60]`, above the drawer) comparing two snapshots, opened from `SnapshotList`'s "Comparar versiones seleccionadas" action:

- **Added** (green) / **Removed** (red) sections list affected products with name + amount
- **Modified** (amber) section lists, per product, every changed field as `Label: before → after` (`FIELD_LABELS` maps API field names like `underlying`, `asset_class`, `catalog_product_id` to Spanish labels; `formatFieldValue` renders amounts via `formatUsd`, categories via their display label, and `underlying` as a compact `Name %` list)
- Loading (spinner), error (`compareError`, red banner), and "Sin cambios entre estas dos versiones" empty states are all handled explicitly so the modal never renders blank

---

## UI Components

### Toast Notifications

**File:** `components/ui/Toast.tsx`

Context-based toast notification system mounted at the root layout.

```typescript
interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

type ToastVariant = "error" | "success" | "info";
```

- **Positioning:** Fixed bottom-right (`bottom-4 right-4 z-50`)
- **Auto-dismiss:** 5 seconds (`AUTO_DISMISS_MS`)
- **Animation:** `animate-slide-in-up` (200ms ease-out slide from below)
- **Manual dismiss:** Close button on each toast
- **Default variant:** `"error"` (red background)

Variant styles:

| Variant | Colors |
|---|---|
| `error` | `bg-red-600 text-white` |
| `success` | `bg-emerald-600 text-white` |
| `info` | `bg-zinc-800 text-white` |

### Topbar

**File:** `components/layout/Topbar.tsx`

Fixed top navigation bar (`h-14`). Contains three sections:

**Left:** SABBI logo badge (lime green "S" on green background) + "SABBI Portfolio Builder" text

**Center:** View tabs using `TabButton` component:

- "Construir portafolio" (builder view)
- "Resumen final" (summary view)
- Active tab has lime green background

**Right:**

- **Exportar** button: Opens `/api/portfolio/me/export` in a new tab for Excel download (browser handles Content-Disposition)
- **Enviar a SABBI** button: Disabled with "Proximamente" tooltip (feature not yet implemented)
- **Admin** link: Only visible when `user.role === "admin"`
- **Salir** button: Calls `logout()` from `useAuth()`

### Icons

**File:** `components/icons/Icons.tsx`

SVG icon library with consistent defaults (24x24 viewBox, stroke-based, `currentColor`). All icons accept an optional `size` prop.

| Icon | Usage |
|---|---|
| `RobotIcon` | Chat panel header, history loader, welcome message, `ChangeLog` "Agente" source icon |
| `CameraIcon` | Screenshot/image attachment indicator, `SnapshotButton` ("Guardar versión") |
| `PdfIcon` | PDF attachment indicator |
| `FileIcon` | Generic file attachment indicator |
| `LinkIcon` | Link input type in welcome message |
| `ClipIcon` | Attachment button, drag-and-drop overlay |
| `SendIcon` | Send button, "Enviar a SABBI" button |
| `EditIcon` | Product card edit button, admin catalog entry edit, `ChangeLog` "Manual" source icon |
| `TrashIcon` | Product card delete button, delete confirmation, admin catalog entry delete |
| `CheckIcon` | `ReadOnlyProductCard` "Aprobar al catálogo" / "Aprobado" button |
| `PlusIcon` | Add product button, add asset class row |
| `DownloadIcon` | Export button |
| `PieIcon` | Empty portfolio state, summary view |
| `ChatIcon` | (Available for use) |
| `XIcon` | Modal close button, remove attachment, remove composition row |
| `InfoIcon` | (Available for use) |
| `MinusIcon` | (Available for use) |
| `WarningIcon` | Delete confirmation warning, `ChangeLog` "Admin" source icon |
| `ChevronDownIcon` | (Available for use) |

### Loading States

**HistoryLoader** (`components/chat/ChatPanel.tsx`): Centered robot icon with concentric ping/pulse circles and bouncing dots. Shown while `isLoadingHistory` is true.

**Portfolio initial loader** (`components/portfolio/PortfolioPanel.tsx`): Spinning border circle with "Cargando portafolio..." text.

**Empty portfolio state** (`components/portfolio/PortfolioPanel.tsx`): Pie chart icon in lime circle, descriptive text, and "Agregar producto manualmente" button.

---

## Data Flow

### usePortfolio Hook

**File:** `lib/usePortfolio.ts`

Central data hook for the portfolio dashboard. Manages:

**Server state:**

- `products: Product[]` -- fetched from `GET /api/portfolio/me`
- `isLoading` / `error` -- loading and error state
- `refetch()` -- manually trigger a re-fetch

**UI state:**

- `activeCategory: CategoryFilter` -- `"todos"` or a specific `Category`
- `editingProduct` / `isModalOpen` / `createCategory` -- modal state
- `openCreateModal(category?)` / `openEditModal(product)` / `closeModal()` -- modal actions

**Derived metrics:**

- `totalAmount` -- sum of all product amounts
- `productCount` -- number of products
- `categoryDistribution` -- amount per category
- `largestPosition` -- `{ product, percentage }` for the product with the highest amount

**New product highlighting:**

- `newProductIds: Set<string>` -- IDs of products that appeared since the last fetch
- Highlight clears after 3 seconds (`NEW_PRODUCT_HIGHLIGHT_MS`)
- First fetch is excluded from diffing to avoid highlighting all initial products

**Refetch triggers:**

- On mount (`useEffect`)
- On `sabbi:portfolio-refetch` custom event (dispatched by the chat panel after each stream completes)
- On `401` response: redirects to `/login`

### Portfolio Events

**File:** `lib/portfolioEvents.ts`

A `window` custom event (`sabbi:portfolio-refetch`) bridges the chat panel and portfolio panel, which are sibling components with no shared React state:

```typescript
export const PORTFOLIO_REFETCH_EVENT = "sabbi:portfolio-refetch";

export function dispatchPortfolioRefetch(): void;
```

Called in `assistant.tsx` at the end of every stream (in the `finally` block of `streamMessage`), regardless of success or failure. The `usePortfolio` hook listens for this event and calls `refetch()`.

### fetchWithAuth

**File:** `lib/fetchWithAuth.ts`

See [Authentication > fetchWithAuth](#fetchWithAuth) above. Used by all authenticated API calls throughout the app.

### API Proxy Routing

See [Pages & Routes > /api/[...path]](#apipath----api-proxy-route) above. The proxy transparently splits traffic between FastAPI and LangGraph based on path prefix.

### Portfolio Types

**File:** `lib/portfolio-types.ts`

Frontend mirror of the backend's `db/models.py`. The `subcategory` field and the `composition` name were removed -- products now carry an `underlying` asset-allocation array (still `{ name, percentage }[]`), and `category` uses full snake_case keys rather than the old short ones:

```typescript
type Category =
  | "inversiones_directas"
  | "mercados_privados"
  | "club_deals"
  | "mercados_publicos"
  | "otros"
  | "cash_y_equivalentes";

interface AssetAllocation {
  name: string;
  percentage: number;
}

interface Product {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  amount: number;
  category: Category;
  underlying: AssetAllocation[];
  asset_class: string;
  geographic_focus: string;
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  catalog_product_id: number | null;
}

interface ProductCreateInput {
  name: string;
  provider?: string;
  amount: number;
  category: Category;
  underlying: AssetAllocation[];
}

interface ProductUpdateInput {
  name?: string;
  provider?: string;
  amount?: number;
  category?: Category;
  underlying?: AssetAllocation[];
}

type FieldSource = "catalog" | "claude_knowledge" | "web_search";
type ProvenanceMap = Record<string, FieldSource>;

interface EnrichedProposedProduct extends ProposedProduct {
  asset_class?: string;
  currency?: string;
  commission?: string;
  administrator?: string;
  manager?: string;
  liquidity?: string;
  return_rate?: string;
  geographic_focus?: string;
  underlying?: { name: string; percentage: number }[];
  catalog_product_id?: number | null;
  primary_source?: FieldSource;
  provenance?: ProvenanceMap;
  reliability_tag?: string;
}

/** A `product_catalog` row -- `GET /admin/catalog/entries`. */
interface CatalogProduct {
  id: number;
  name: string;
  geographic_focus: string;
  asset_class: string;
  underlying: AssetAllocation[];
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  category: string;
  alternative_names: string[];
  approved_from_product_id: string | null;
  approved_at: string | null;
}

/** Admin-submitted payload for `POST /admin/catalog/approve`. */
interface CatalogProductCreate {
  name: string;
  category: string;
  asset_class?: string;
  geographic_focus?: string;
  underlying?: AssetAllocation[];
  commission?: string;
  currency?: string;
  administrator?: string;
  manager?: string;
  liquidity?: string;
  return_rate?: string;
  approved_from_product_id?: string | null;
  catalog_product_id?: number | null;
}
```

---

## Styling & Design System

### Color Palette (SABBI Brand)

**File:** `app/globals.css`

| Token | Hex | Usage |
|---|---|---|
| `--sabbi-green` | `#2B3C2B` | Primary brand, buttons, accent |
| `--sabbi-lime` | `#C5D82D` | Active tabs, logo badge, highlights |
| `--sabbi-gold` | `#D4A843` | Login hero headline accent |
| `--sabbi-cream` | `#F2EDE4` | Page background |

**Surface tokens:**

| Token | Hex | Usage |
|---|---|---|
| `--bg-page` | `#F2EDE4` | Page background |
| `--bg-card` | `#ffffff` | Card backgrounds |
| `--bg-panel` | `#F7F4EF` | Panel backgrounds, code blocks |
| `--bg-chat` | `#EBE7DF` | Chat area background |

**Text hierarchy:**

| Token | Hex | Usage |
|---|---|---|
| `--text-1` | `#1a1a18` | Primary text |
| `--text-2` | `#6b6a65` | Secondary text, labels |
| `--text-3` | `#9c9b96` | Tertiary text, placeholders |

**Category colors** (6 categories, each with accent/badge-bg/badge-text):

| Category | Key | Accent | Badge BG | Badge Text |
|---|---|---|---|---|
| Inversiones directas | `inversiones_directas` | `#c2410c` | `#fff7ed` | `#9a3412` |
| Mercados privados | `mercados_privados` | `#7c3aed` | `#f5f3ff` | `#5b21b6` |
| Club deals | `club_deals` | `#0d9488` | `#f0fdfa` | `#115e59` |
| Mercados publicos | `mercados_publicos` | `#2563eb` | `#eff6ff` | `#1e40af` |
| Otros | `otros` | `#d97706` | `#fffbeb` | `#92400e` |
| Cash y equivalentes | `cash_y_equivalentes` | `#16a34a` | `#f0fdf4` | `#166534` |

**Status colors:**

| Token | Hex |
|---|---|
| `--danger` | `#dc2626` |
| `--success` | `#059669` |

### CSS Variables and Tailwind Tokens

**File:** `app/globals.css`

The `@theme inline` block maps CSS custom properties to Tailwind utility classes:

- `--color-sabbi-primary` -> `bg-sabbi-primary`, `text-sabbi-primary`, etc.
- `--color-sabbi-green` -> `bg-sabbi-green`, `text-sabbi-green`, etc.
- All category colors -> `bg-sabbi-cat-inversiones_directas`, etc.
- All neutral grays -> `bg-sabbi-neutral-50` through `bg-sabbi-neutral-900`

**Design tokens:**

| Token | Value |
|---|---|
| `--radius` | `10px` |
| `--radius-lg` | `14px` |
| `--shadow-card` | Subtle card shadow |
| `--shadow-hover` | Elevated hover shadow |
| `--transition` | `0.2s cubic-bezier(0.4, 0, 0.2, 1)` |

### Composition Palette

**File:** `lib/compositionPalette.ts`

Deterministic color assignment for product composition bars (index-based, wraps at 8):

```
#2B3C2B, #3D5A3D, #0d9488, #2563eb, #64748b, #f59e0b, #ec4899, #14b8a6
```

### Typography

**File:** `app/layout.tsx`

Two Google Fonts loaded with `next/font/google`:

| Font | Variable | Usage |
|---|---|---|
| Inter | `--font-inter` | Body text, labels, inputs (`--font-sans`) |
| DM Sans | `--font-dm-sans` | Display numbers, metric values, amounts (`--font-display`) |

Both use `display: "swap"` and `subsets: ["latin"]`.

### Animations

**File:** `app/globals.css`

| Class | Animation | Duration | Usage |
|---|---|---|---|
| `thinking-dot` | `thinking-pulse` (opacity 0.3-1-0.3) | 1.2s infinite | Thinking indicator dots |
| `animate-login-error` | `login-error` (horizontal shake) | 0.4s | Login error message |
| `animate-card-enter` | `card-enter` (fade + slide up 8px) | 240ms | Card mount animation |
| `animate-product-added` | `card-enter` + `product-added` (green pulse ring) | 280ms + 2s | Newly added product highlight |
| `animate-metric-flash` | `metric-flash` (green bg fade) | 1.8s | Metric value change |
| `animate-modal-overlay` | `modal-overlay-in` (fade in) | 180ms | Modal backdrop |
| `animate-modal-panel` | `modal-panel-in` (scale 0.96 + slide up) | 200ms | Modal content |
| `animate-slide-in-up` | `slide-in-up` (fade + slide up 12px) | 200ms | Toast notifications |
| `animate-drawer-panel` | `drawer-panel-in` (slide in from right) | 220ms | `VersioningDrawer` right-side slide-over |
| `animate-row-delete` | `row-fade-out` (red flash + fade + scale down) | 350ms | Admin catalog table row deletion |
| `propose-card-highlight` | `card-highlight-pulse` (lime box-shadow pulse) | 1.5s x2 | Solo pending `ProposeProductCard` highlight |

### Assistant Markdown Styles

**File:** `app/globals.css`

The `.assistant-markdown` class provides consistent prose styling for assistant messages:

- 14px font size, 1.6 line height
- Word-break handling for long URLs/text
- Styled tables with borders, padding, and nowrap cells
- Inline code with border and background
- Code blocks with overflow-x scroll
- Lists with proper indentation

### Tool Result Card Styles

**File:** `app/globals.css`

CSS adjacency selectors on `.tool-result-item` merge consecutive tool result rows into a visual group:

- Each row has full border/radius by default (standalone card appearance)
- Adjacent rows: previous row loses bottom radius, next row loses top border + radius
- Creates a seamless grouped card with 1px dividers

---

## Category Taxonomy

**File:** `lib/categories.ts`

### Category Order and Metadata

Six categories in fixed display order, using the full snake_case keys the backend stores (renamed from the earlier short keys -- see [Legacy Category Aliases](#legacy-category-aliases) below):

```typescript
const CATEGORY_ORDER: Category[] = [
  "inversiones_directas",
  "mercados_privados",
  "club_deals",
  "mercados_publicos",
  "otros",
  "cash_y_equivalentes",
];
```

Each category has full metadata (`CategoryMeta`) including label, short label, and CSS variable references.

### Subcategory Taxonomy (3-Level)

Mirrors the backend's taxonomy (`agent/state.py::CATEGORIES`). Structure: `Category -> Group -> Leaf`. Products no longer store a standalone `subcategory` field -- this taxonomy is now used purely to populate the composition-row dropdowns in `EditProductModal` and `ProposeProductCard` (via `CATEGORY_SUBCATEGORIES[category]`), where each selected leaf becomes one `underlying` entry.

| Category | Groups | Leaves (examples) |
|---|---|---|
| `inversiones_directas` | RE Perú, RE Extranjero | Residencial, Oficinas, Comercial/Industrial |
| `mercados_privados` | Deuda Privada, Private Equity, VC, Real Estate, Hedge Funds, Infraestructura | (same as group) |
| `club_deals` | Real Estate, Deuda Privada, Otros | Perú, Extranjero |
| `mercados_publicos` | Renta Variable, Renta Fija | US Large Cap, US Treasuries, IG Corporates, High Yield, EM Bonds, etc. |
| `otros` | Cripto, Commodities | Bitcoin, Ethereum, Otras, Oro |
| `cash_y_equivalentes` | Cash | Depósitos a plazo, Fondos de Money Market |

### Legacy Category Aliases

`LABEL_TO_KEY` (built from `CATEGORY_META` labels, plus a few explicit lowercase-label entries) also includes the **old short keys** as legacy aliases, since existing database rows and older change-log/snapshot records may still carry them:

```typescript
"directas": "inversiones_directas",
"privados": "mercados_privados",
"club": "club_deals",
"publicos": "mercados_publicos",
"cash": "cash_y_equivalentes",
```

`resolveCategoryKey(value: string): Category` normalizes any known alias (or full label, case-insensitively) back to the current `Category` key, falling back to `"otros"` for anything unrecognized. It's used wherever a category value might come from older stored data -- e.g. `ChangeLog`'s before/after diffing, `SnapshotList`'s category-summary merge, and the admin portfolio view's product list.

### Helper Functions

```typescript
categoryColorVar(category: Category): string   // e.g. "var(--sabbi-cat-inversiones_directas)"
categoryBgVar(category: Category): string       // e.g. "var(--sabbi-cat-inversiones_directas-bg)"
categoryTextVar(category: Category): string     // e.g. "var(--sabbi-cat-inversiones_directas-text)"
```

---

## Formatting Utilities

**File:** `lib/format.ts`

| Function | Input | Output Example | Usage |
|---|---|---|---|
| `formatUsd(amount)` | `150000` | `$150,000` | Product cards, tables |
| `formatAbbreviatedUsd(amount)` | `1200000` | `$1.2M` | Metric cards, donut center, snapshot totals |
| `formatAbbreviatedUsd(amount)` | `150000` | `$150K` | Metric cards |
| `formatRelativeTime(iso)` | recent ISO timestamp | `"recién"`, `"hace 5m"`, `"hace 2h"` | `ChangeLog` / `VersioningBar` timestamps -- falls back to a short `es-PE` date once older than a day |
| `formatDateTime(iso)` | ISO timestamp | `"14 jul 2026, 09:30"` | `SnapshotList`, `ComparisonView` full date/time labels (`es-PE`) |

---

## Testing

**Test runner:** Vitest 4.x with jsdom environment

**Setup:** `vitest.setup.ts` runs `@testing-library/jest-dom/vitest` matchers and `cleanup()` after each test.

**Config:** `vitest.config.ts` sets `oxc.jsx: "automatic"` (overrides Next.js's `jsx: "preserve"` for test compatibility) and aliases `@/` to the project root.

### Test Files

**`__tests__/propose-product-card.test.tsx`** -- Tests for `ProposeProductCard`:

- Rendering with full fields (no missing-fields warning)
- Missing `underlying` composition shows warning and disables confirm
- Error result renders nothing
- Editing amount clears validation warning
- Confirm sends exact structured text and shows "Confirmado"
- Confirm is a no-op when card is invalid
- Reject sends rejection text and shows "Descartado"
- Registration in `ProposalBatchProvider` on mount
- Unregistration on unmount

**`__tests__/bulk-accept-bar.test.tsx`** -- Tests for `BulkAcceptBar`:

- Renders nothing with a single pending entry
- Shows count and disables bulk button with invalid entries
- Hides after all entries are individually responded to
- "Agregar todos" sends combined message and marks all confirmed

Both test files mock `@assistant-ui/react` primitives with proxy stubs and track `useThreadRuntime().append` calls.

---

## Configuration Files

### `next.config.ts`

```typescript
{
  output: "standalone",                    // Docker-optimized build
  devIndicators: { position: "top-left" }, // Move dev overlay
  outputFileTracingRoot: "../../",         // Yarn workspace monorepo root
}
```

### `tsconfig.json`

- Target: ES2017
- Module: ESNext with bundler resolution
- Strict mode enabled
- Path alias: `@/*` -> `./*`
- Next.js plugin included

### `package.json` Scripts

| Script | Command |
|---|---|
| `dev` | `next dev --port 3000` |
| `build` | `next build` |
| `start` | `next start` |
| `lint` | `eslint .` |
| `test` | `vitest run` |

---

## Legacy LangGraph SDK Helper

**File:** `lib/chatApi.ts`

Factory function for the LangGraph SDK `Client`. This is kept as a helper for compatibility with earlier scaffolded assistant-ui code, but it is not used by the current portfolio chat runtime.

- **Browser:** Uses `NEXT_PUBLIC_LANGGRAPH_API_URL` when present, otherwise falls back to `/api`
- **Server (SSR):** Falls back to `/api`

The actual chat streaming in `assistant.tsx` uses `fetchWithAuth` directly against `POST /api/chat/threads/:threadId/messages/stream`.

---

## Thread List Adapter

**File:** `lib/threadListAdapter.ts`

Currently a no-op stub. Thread persistence is handled server-side by FastAPI with `AsyncPostgresSaver`. The active thread ID is stored in the `users` table (`active_thread_id` column) and resolved via `AuthUser`.
