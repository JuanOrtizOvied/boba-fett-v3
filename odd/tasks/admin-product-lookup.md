# Feature: admin "Buscar producto" — single-name cascade lookup

- **Feature ID:** `admin-product-lookup`
- **File locator:** `odd/tasks/admin-product-lookup.md`
- **Engram mirror topic:** `odd/admin-product-lookup/tasks`
- **Branch:** `feat/admin-product-lookup` off `feat/admin-single-catalog-section` (which is
  itself unmerged off `main` — so merging this branch brings the catalog consolidation too).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q -p no:recording`;
  web `cd apps/web && yarn vitest run <file>` + `npx tsc --noEmit`.
- **Route:** INLINE single writer.

## User request
> "debemos implementar una seccion que solo busco un producto por el nombre ingresado
> con la misma logica, primero catalogo y si no encuentra buscar en la web con claude"

A standalone admin section: type a product name → run the SAME enrichment cascade the ficha
uses (`cascade_search_v2`: normalized catalog L1 → Claude knowledge L2 → Claude web L3) →
show the result. READ-ONLY lookup (assumption from "solo busco"): view the enriched product,
no approve/create/edit.

## Design / reuse
- Backend `cascade_search_v2(name, pool)` already IS "catalog first, then web with Claude";
  it is only wired into the ficha parse today. Expose it via a new single-name endpoint.
- `SearchResult` (frontend type) already carries everything to display: provenance,
  confidence, series_options (with suggested confidence), sources, web_search_insufficient.

## Tasks
- [x] **T-1 — Backend: `POST /admin/product-lookup`.** DONE. INLINE (TDD). Added
  `ProductLookupRequest {name}` + `product_lookup` endpoint returning `SearchResult | None`
  (null when the cascade finds nothing), reusing `cascade_search_v2(name, product_repo.pool)`;
  blank name → null with no DB/LLM call. Router-level `require_admin` guards it. TDD: RED (404)
  → GREEN. 4 tests (returns result + trims name + passes pool; null when None; blank
  short-circuit no cascade call; non-admin blocked). Checks: ficha-routes suite 39 passed;
  ruff clean. Commit: `<pending>`.
- [ ] **T-2 — Frontend: "Buscar producto" page + nav + read-only result.** `fichaApi` (or new
  `catalogLookupApi`) `lookupProduct(name): Promise<SearchResult | null>` →
  `POST /api/admin/product-lookup`. New route `app/admin/buscar-producto/page.tsx`: name input +
  search button + states (idle/loading/empty/result). Read-only result component: source badge
  (Catálogo/Claude/Web) + confidence pill; product fields; asset_class/geographic_focus/
  underlying; series_options (with ✨ suggested badge); Fuentes; the "no se encontró / insuficiente"
  notice. Nav entry in `app/admin/layout.tsx`: `{ href: "/admin/buscar-producto", label: "Buscar producto" }`.
  Tests + tsc.

## Acceptance criteria
- A "Buscar producto" admin section runs the catalog→web cascade on the entered name and shows
  the enriched result read-only, with its origin (catalog/web), confidence, series and sources.
- Not-found (null) and insufficient-web results are clearly messaged.
- Backend + web suites green; no change to the ficha flow or the cascade logic itself.

## Next step
T-1 backend endpoint (RED test first).
