# Tasks: Admin Ficha Patrimonial Import

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1150-1300 (new ~1000-1150, modified ~130) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 2 -> PR 3 -> PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Parser module + unit tests (`ficha_patrimonial.py`) | PR 1 | Standalone, no API/UI dependency. Base: main (stacked) or tracker branch (feature-chain). ~400 lines |
| 2 | Parse + confirm endpoints + integration tests (`admin_routes.py`) | PR 2 | Depends on PR 1 module. Base: main or PR 1 branch. ~330 lines |
| 3 | Upload flow: `page.tsx`, `UploadZone.tsx`, nav link | PR 3 | Builds against PR 2's documented contract. Base: main or PR 2 branch. ~280 lines |
| 4 | Review table, confirm wiring, e2e verification | PR 4 | Depends on PR 3. Base: main or PR 3 branch. ~250 lines |

## Phase 1: Backend Foundation — Excel Parser Module

- [x] 1.1 Create `apps/backend/src/db/ficha_patrimonial.py`: column consts (C/J/K/L/M/N), row consts (client row 5, products 8+, real estate 27+, stop at blank/"Total").
- [x] 1.2 Implement `parse_ficha_excel()`: extract client info + product rows, exclude real-estate rows. Spec: "Excel Parsing — Sabbi Sheet".
- [x] 1.3 [TDD] RED/GREEN: `normalize_return_rate()` tests + impl ("7.5%"->"7.5", 0.08->"8.0", ""->""). Spec: "Return Rate Normalization".
- [x] 1.4 Implement `TIPO_ACTIVO_MAP` + `map_asset_class()`; unrecognized values flagged unmapped. Spec: "Asset Class Mapping".
- [x] 1.5 Define Pydantic models: `FichaParseRequest/Row/Response`, `FichaConfirmRequest/Row` per design contracts.
- [x] 1.6 [TDD] RED/GREEN: fixture `.xlsx` tests (openpyxl-built in conftest) for `parse_ficha_excel()` — 15-row case, blank/"Total" stop, real-estate exclusion, missing "Sabbi" sheet error.
- [x] 1.7 [TDD] RED/GREEN: `map_asset_class()` tests — 6 known values + unknown fallback.

## Phase 2: Backend API — Parse & Confirm Endpoints

- [x] 2.1 Add `POST /admin/ficha-patrimonial/parse` in `apps/backend/src/api/admin_routes.py`: decode base64 xlsx, call `parse_ficha_excel()`, `require_admin` guard. Spec: "Ficha Parse Endpoint", "Non-admin blocked".
- [x] 2.2 Resolve user via `UserRepository.get_by_email()` in parse endpoint; 404 hard-fail if missing. Spec: "Target User Resolution by Email".
- [x] 2.3 Wire enrichment: `Semaphore(3)` + `gather(cascade_search(...))`, merge Excel fields with `SearchResult` (Excel amount/currency win), isolate per-row failures. Spec: "Batch Enrichment via cascade_search".
- [x] 2.4 Return 400 on corrupt file / missing "Sabbi" sheet. Spec: "Invalid or corrupt file rejected", "Missing Sabbi sheet".
- [x] 2.5 Add `POST /admin/ficha-patrimonial/confirm`: `pool.acquire()` + `conn.transaction()`, loop `repo.create(..., source="admin_ficha_import", conn=conn)`. Spec: "Confirm creates all products".
- [x] 2.6 [TDD] RED/GREEN: parse integration tests (httpx AsyncClient, mocked `cascade_search`) — valid ficha, corrupt file, missing sheet, non-admin, unknown email.
- [x] 2.7 [TDD] RED/GREEN: confirm integration tests (real DB) — all-N-created with `source: "admin_ficha_import"`, zero-created on invalid row/unknown user (rollback).

## Phase 3: Frontend — Upload Flow

- [x] 3.1 Create `apps/web/components/admin/ficha-patrimonial/UploadZone.tsx`: `.xlsx`-only picker, `FileReader.readAsDataURL()` base64 encode.
- [x] 3.2 Create `apps/web/app/admin/ficha-patrimonial/page.tsx`: upload/loading/review states, `fetchWithAuth()` to parse endpoint, loading indicator (~60s). Spec: "Ficha Upload Page". (No Suspense wrapper — page has no `useSearchParams()`, unlike catalog's URL-synced search.)
- [x] 3.3 Handle parse failure on the page: show error, allow re-upload, no partial table. Spec: "Parse failure keeps page usable".
- [x] 3.4 Add nav entry to `apps/web/app/admin/layout.tsx` NAV_LINKS: `{ href: "/admin/ficha-patrimonial", label: "Ficha Patrimonial" }`.

## Phase 4: Frontend — Review Table & Confirm

- [x] 4.1 Create `apps/web/components/admin/ficha-patrimonial/ReviewTable.tsx`: original + enriched values, match-quality badge per row. Spec: "Review Table Editing".
- [x] 4.2 Add editable asset-class dropdown (ASSET_CLASSES keys); flag + block confirm on unmapped rows. Spec: "Unmapped row blocks confirm".
- [x] 4.3 Support manual edits overriding suggestions, sent verbatim on confirm. Spec: "Manual edits override suggestions".
- [x] 4.4 Render "Pertenencia" read-only; exclude from confirm payload. Spec: "Ownership displayed but not stored".
- [x] 4.5 Wire "Confirmar" in `page.tsx` to confirm endpoint; show count-based success summary and reset. Spec: "Bulk Confirm and Success Summary".
- [x] 4.6 On confirm failure, keep review table populated and editable for retry. Spec: "Failed confirm preserves review state".

## Phase 5: Integration & Verification

- [ ] 5.1 Manual e2e pass on dev stack: upload sample ficha -> review -> confirm -> verify products in portfolio dashboard.
- [x] 5.2 Run `pytest -q` (backend) and `ruff check` (backend); confirm no regressions. tsc clean on ficha files; pre-existing test errors unchanged.
