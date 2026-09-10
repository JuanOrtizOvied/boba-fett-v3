# Proposal: Admin Ficha Patrimonial Import

## Intent

SABBI operators currently onboard investor portfolios one product at a time via the chat agent. For clients who submit a "Ficha Patrimonial" Excel file (a standardized financial questionnaire), this means manually re-entering 15+ products — slow, error-prone, and a bottleneck to scaling onboarding. This change adds an admin screen to upload, parse, enrich, review, and bulk-import an entire Ficha Patrimonial into an investor's portfolio in one operation.

## Scope

### In Scope
- Admin page at `/admin/ficha-patrimonial` with file upload, review table, and bulk-confirm flow
- Server-side Excel parsing of the "Sabbi" sheet (row 5 client info, rows 8-N product data, columns C/J/K/L/M/N)
- Per-product enrichment via existing `cascade_search()` with bounded concurrency
- Review table showing original vs enriched data, match quality badge, editable asset-class dropdown
- "Tipo de activo" free-text to `ASSET_CLASSES` (state.py) mapping with unmapped fallback
- Return rate format normalization ("7.5%" / 0.08 / "8%" -> consistent format)
- Bulk product creation under a single transaction (all-or-nothing)
- User resolution by email from row 5 (lookup only, no auto-create)

### Out of Scope
- Real estate rows (rows 27+) from the Ficha Patrimonial
- Draft/session persistence (browser reload loses in-progress review)
- Auto-creation of user accounts from ficha data
- Multipart file upload (`python-multipart` dependency) — using base64-JSON instead
- Reconciliation with existing portfolio products (duplicate detection)
- Batch upload of multiple fichas at once

## Capabilities

### New Capabilities
- `admin-ficha-import`: Upload, parse, enrich, review, and bulk-import Ficha Patrimonial Excel files into investor portfolios

### Modified Capabilities
- `admin-panel`: Adds a nav entry and a mutation path (bulk-import) to a module currently specified as read-only oversight

## Approach

**Two-phase API** with server-side parsing:

1. **Parse + Enrich** (`POST /admin/ficha-patrimonial/parse`): Accept base64-encoded `.xlsx` in JSON body. Parse "Sabbi" sheet via `openpyxl`. Extract client info (row 5) and product rows (8-N, stop at "Total"/blank). Run `cascade_search()` per product with `asyncio.Semaphore(3)`. Return enriched rows with per-field provenance and suggested `ASSET_CLASSES` mapping.

2. **Confirm + Create** (`POST /admin/ficha-patrimonial/confirm`): Accept admin-reviewed rows + target `user_id`. Bulk-insert via `ProductRepository.create()` calls sharing one `conn` (single transaction). Source tag: `"admin_ficha_import"`.

**Frontend**: New admin page following `catalog/page.tsx` patterns. Upload button -> loading state during enrichment -> review table with editable cells -> confirm button.

**Key Decisions**:

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Asset-class taxonomy | `ASSET_CLASSES` (state.py) | What `products.asset_class` and the dashboard actually consume |
| Upload transport | Base64-JSON | Matches existing chat attachment convention; no new dependency |
| Bulk atomicity | All-or-nothing (shared `conn`) | Partial imports leave inconsistent state for operators |
| User resolution | Email lookup, fail if not found | Auto-create is a security risk; admin creates users separately |
| Enrichment concurrency | `asyncio.Semaphore(3)` | Prevents rate-limit storms on Claude/Tavily for ~15-row batches |
| Draft persistence | None (client state only, v1) | Acceptable tradeoff; fichas are re-uploadable |
| Return rate format | Server-side normalizer to decimal string | "7.5%" -> "7.5", 0.08 -> "8.0" |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/backend/src/api/admin_routes.py` | Modified | Two new endpoints: parse and confirm |
| `apps/backend/src/db/ficha_patrimonial.py` | New | Excel parsing + return-rate normalizer |
| `apps/backend/src/db/models.py` | Modified | New Pydantic models for parsed/enriched rows |
| `apps/backend/src/agent/state.py` | Read-only | `ASSET_CLASSES` used as taxonomy target |
| `apps/backend/src/agent/search.py` | Read-only | `cascade_search()` called in batch |
| `apps/web/app/admin/ficha-patrimonial/page.tsx` | New | Upload + review + confirm page |
| `apps/web/app/admin/layout.tsx` | Modified | New `NAV_LINKS` entry |
| `apps/web/components/admin/ficha-patrimonial/` | New | ReviewTable, UploadButton components |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| cascade_search latency on uncataloged products (~15 Claude/Tavily calls) | High | Semaphore(3) + loading skeleton per row; parse endpoint may take 30-60s |
| "Tipo de activo" values not in mapping table | Med | Editable dropdown in review table with "unmapped" visual flag |
| User email from ficha not found in system | Med | Clear error with link to admin user-creation page |
| Excel layout changes between ficha versions | Low | Column-letter constants in one module; easy to update |
| Browser reload loses review state | Low (v1) | Accepted tradeoff; re-upload is fast |

## Rollback Plan

All changes are additive: new endpoints, new page, new nav link. Rollback = revert the PR. No migrations, no schema changes, no existing behavior modified. The admin-panel spec delta only adds capabilities; removing it restores read-only semantics.

## Dependencies

- `openpyxl` — already installed (used by `db/excel.py`)
- `cascade_search()` — existing, no changes needed
- `ProductRepository.create()` — existing, `conn` param already supports shared transactions
- `require_admin` — existing router-level dependency
- Authenticated user with `admin` role

## Success Criteria

- [ ] Admin can upload a Ficha Patrimonial `.xlsx` and see parsed products in a review table within 60 seconds
- [ ] Each product row shows: original Excel data, enriched data from cascade_search, match quality badge, editable asset-class dropdown
- [ ] "Tipo de activo" free-text maps to correct `ASSET_CLASSES` key for known values; unknown values flagged for manual selection
- [ ] Return rates normalized consistently regardless of input format
- [ ] Confirming creates all products in the target user's portfolio atomically (all succeed or all fail)
- [ ] Non-admin users cannot access any ficha-patrimonial endpoint or page
- [ ] User not found by email produces a clear, actionable error

## Proposal Question Round

The following assumptions would benefit from user confirmation before moving to specs:

1. **User resolution strictness**: The proposal assumes email-only lookup with a hard failure if the user doesn't exist. Should the admin also be able to manually search/select a target user from a dropdown (decoupling the ficha's client info from user resolution)?

2. **"Tipo de activo" mapping completeness**: The known free-text values are "Acciones en bolsa", "Fondos mutuos", "Cuenta ahorros", "Deposito plazo fijo", "Inversiones alternativas (private equity/venture capital/etc)", "Otro". Should the mapping table be hardcoded for these known values only, or should there be an admin UI to manage the mapping table over time?

3. **Enrichment granularity**: Should cascade_search enrich ALL products (including ones clearly identifiable like "Cuenta ahorros BCP"), or should the system skip enrichment for products that map cleanly to a known catalog entry at L1 and only escalate to L2/L3 for unknowns? This affects both latency and API cost.

4. **Post-import navigation**: After successful bulk-import, should the admin be redirected to the investor's portfolio view (`/admin/portfolios/:userId`) to verify the result, or stay on the ficha page with a success summary?

5. **Ownership column (L)**: The "Pertenencia" column exists in the Excel but `ProductCreate` has no `ownership` field. Should this data be stored (requires a schema addition), stored in metadata JSON, displayed in review but discarded on import, or is it out of scope entirely?
