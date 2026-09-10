# Design: Admin Ficha Patrimonial Import

## Technical Approach

Two-phase API (parse+enrich, confirm+create) with server-side openpyxl parsing. The backend receives a base64-encoded `.xlsx`, parses the "Sabbi" sheet into structured rows, enriches each via `cascade_search()` with `Semaphore(3)`, maps "Tipo de activo" free-text to `ASSET_CLASSES` keys (state.py), and returns enriched rows for admin review. On confirm, bulk-inserts all products under one transaction using `ProductRepository.create(conn=shared_conn)`. Frontend is a new admin page following the `catalog/page.tsx` Suspense + fetchWithAuth + table pattern, with client-side React state for the two-phase flow.

## Architecture Decisions

| Decision | Choice | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Excel parser location | New `db/ficha_patrimonial.py` module | Inline in admin_routes; new `internal/` directory | No `internal/` dir exists. `db/` already has `excel.py` (export). Keeps parsing testable in isolation. |
| Pydantic models location | New models in `db/ficha_patrimonial.py` alongside parser | Add to `db/models.py` | `models.py` is already 380+ lines of unrelated models. Colocating parser + models keeps the module self-contained. |
| Pool access for cascade_search | `request.app.state.repo.pool` via existing `_product_repo` | Store pool directly on `app.state`; new dependency function | Pool is already reachable through repo; no lifespan change needed. |
| Tipo de activo mapping | Hardcoded `TIPO_ACTIVO_MAP: dict[str, str]` in `ficha_patrimonial.py` | DB table; config file; cascade_search._classify() | Known finite set of 6 values. DB table is overkill for v1. `_classify()` is tuned for product names, not category labels. |
| Enrichment concurrency | `asyncio.Semaphore(3)` + `asyncio.gather()` | Sequential; unbounded gather | Prevents rate-limit storms on Claude/Tavily while still parallelizing a 15-row batch (~5x faster than sequential). |
| Bulk insert atomicity | Loop `repo.create(conn=shared_conn)` inside one `pool.acquire() + transaction()` | New `bulk_create()` on ProductRepository; individual transactions | `create()` already supports `conn` param. No new repo method needed. Atomicity via shared conn matches existing pattern. |
| Upload transport | Base64-JSON body | Multipart `UploadFile` | No `python-multipart` in deps, no existing multipart endpoint. Base64-JSON matches `chat_routes.py` attachment convention. |
| Admin route wiring | New endpoints on existing `admin_routes.router` | Separate `ficha_routes.py` router | All admin endpoints already live in one router with shared `require_admin` dependency. Two new endpoints don't justify a new router. |

## Data Flow

```
  Admin uploads .xlsx          POST /admin/ficha-patrimonial/parse
        |                              |
        v                              v
  Browser FileReader         base64 JSON body
  readAsDataURL()            { file_data, file_name }
        |                              |
        v                              v
  fetchWithAuth()  -------->  admin_routes.py
                                       |
                              openpyxl parse "Sabbi" sheet
                              row 5 -> client_info (email)
                              rows 8-N -> raw product rows
                                       |
                              UserRepository.get_by_email()
                              (hard fail if not found)
                                       |
                              TIPO_ACTIVO_MAP lookup per row
                              normalize_return_rate() per row
                                       |
                              Semaphore(3) + gather:
                              cascade_search(name, pool) x N
                                       |
                              Merge: Excel data + SearchResult
                              (Excel amount/currency win;
                               enriched fields fill gaps)
                                       |
                                       v
                              FichaParseResponse {
                                client: { email, name, user_id }
                                rows: FichaEnrichedRow[]
                              }
                                       |
                                       v
  Admin reviews table  <--------  JSON response
  Edits asset_class dropdowns
  Edits amounts/fields
  Clicks "Confirmar"
        |
        v
  POST /admin/ficha-patrimonial/confirm
  { user_id, products: FichaConfirmRow[] }
        |
        v
  admin_routes.py
  pool.acquire() -> conn.transaction():
    for row in products:
      repo.create(user_id, ProductCreate(...),
                  source="admin_ficha_import", conn=conn)
        |
        v
  { created_count, product_ids }
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/src/db/ficha_patrimonial.py` | Create | Excel parser (openpyxl), `TIPO_ACTIVO_MAP`, `normalize_return_rate()`, Pydantic request/response models (`FichaParseRequest`, `FichaParsedRow`, `FichaEnrichedRow`, `FichaParseResponse`, `FichaConfirmRequest`, `FichaConfirmRow`) |
| `apps/backend/src/api/admin_routes.py` | Modify | Two new endpoints: `POST /admin/ficha-patrimonial/parse` (parse+enrich), `POST /admin/ficha-patrimonial/confirm` (bulk create). Imports from `db/ficha_patrimonial` and `agent/search`. New `_pool` dependency: `request.app.state.repo.pool` |
| `apps/web/app/admin/ficha-patrimonial/page.tsx` | Create | Main page: Suspense wrapper, three-state UI (upload -> review -> success), fetchWithAuth calls to both endpoints |
| `apps/web/components/admin/ficha-patrimonial/UploadZone.tsx` | Create | Drag-and-drop / click-to-upload zone. FileReader base64 encoding. `.xlsx` only validation |
| `apps/web/components/admin/ficha-patrimonial/ReviewTable.tsx` | Create | Enriched rows table with editable cells, asset-class dropdown (ASSET_CLASSES keys), match quality badge (primary_source), amount input |
| `apps/web/app/admin/layout.tsx` | Modify | Add `{ href: "/admin/ficha-patrimonial", label: "Ficha Patrimonial" }` to `NAV_LINKS` |

## Interfaces / Contracts

### Parse Endpoint

```
POST /admin/ficha-patrimonial/parse
Content-Type: application/json

Request:
{
  "file_data": "base64-encoded-xlsx-content",
  "file_name": "ficha_cliente.xlsx"
}

Response 200:
{
  "client": {
    "email": "investor@example.com",
    "name": "Juan Perez",
    "user_id": "uuid-string"
  },
  "rows": [
    {
      "excel_row": 8,
      "raw_name": "Fondo XYZ",
      "raw_tipo_activo": "Fondos mutuos",
      "raw_amount": 50000.0,
      "raw_currency": "USD",
      "raw_return_rate": "7.5%",
      "raw_pertenencia": "Titular",
      "mapped_asset_class": "mercados_publicos",
      "normalized_return_rate": "7.5",
      "enriched": {
        "name": "Fondo XYZ - BlackRock",
        "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
        "geographic_focus": [...],
        "underlying": [...],
        "commission": "1.5%",
        "currency": "USD",
        "administrator": "BlackRock",
        "manager": "...",
        "liquidity": "Diaria",
        "return_rate": "7.5",
        "catalog_product_id": 42,
        "primary_source": "catalog",
        "provenance": {"name": "catalog", "commission": "claude_knowledge"}
      },
      "enrichment_failed": false
    }
  ]
}

Response 400: { "detail": "Sheet 'Sabbi' not found" }
Response 404: { "detail": "User with email investor@example.com not found" }
```

### Confirm Endpoint

```
POST /admin/ficha-patrimonial/confirm
Content-Type: application/json

Request:
{
  "user_id": "uuid-string",
  "products": [
    {
      "name": "Fondo XYZ - BlackRock",
      "provider": "",
      "amount": 50000.0,
      "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
      "geographic_focus": [...],
      "underlying": [...],
      "commission": "1.5%",
      "currency": "USD",
      "administrator": "BlackRock",
      "manager": "...",
      "liquidity": "Diaria",
      "return_rate": "7.5",
      "catalog_product_id": 42
    }
  ]
}

Response 201: { "created_count": 15, "product_ids": ["prod_abc123", ...] }
Response 422: Pydantic validation errors (amount <= 0, etc.)
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `parse_ficha_excel()`: correct row extraction, stop at "Total"/blank, column mapping | pytest with fixture `.xlsx` files built via openpyxl in conftest |
| Unit | `normalize_return_rate()`: "7.5%" -> "7.5", 0.08 -> "8.0", "8" -> "8.0", "" -> "" | pytest parametrize |
| Unit | `TIPO_ACTIVO_MAP` coverage: all 6 known values + unknown fallback | pytest parametrize |
| Integration | Parse endpoint: upload -> enriched response with mocked cascade_search | pytest + httpx AsyncClient, mock cascade_search |
| Integration | Confirm endpoint: bulk create -> all products in DB, audit log entries, rollback on failure | pytest + httpx AsyncClient, real DB |

## Migration / Rollout

No migration required. All changes are additive: new endpoints, new page, new nav link. No schema changes. `ProductCreate` model and `products` table are unchanged. Rollback = revert the PR.

## Open Questions

- [ ] Should the parse endpoint stream progress (SSE per-row enrichment status) or return all-at-once? All-at-once is simpler but the admin sees no progress for 30-60s. v1 starts with all-at-once + a loading spinner; SSE can be added later if UX feedback demands it.
