# Feature: Export portfolio into the SABBI client template (ACTUAL pre-filled)

- **Feature ID:** `export-portfolio-template`
- **File locator:** `odd/tasks/export-portfolio-template.md`
- **Engram mirror topic:** `odd/export-portfolio-template/tasks`
- **Branch:** `feat/export-portfolio-template` (off `main`)
- **TDD mode:** strict. Backend runner: `apps/backend/.venv/bin/python -m pytest -q` (unit, no DB).

## Objective

The "exportar" button (`GET /portfolio/me/export`) must return a workbook whose first
sheet is **identical to** the attached client template
(`src/db/templates/portafolio_final_template.xlsx`), with the **"ACTUAL (* NO TOCAR *)"
column (column D)** PRE-FILLED from the user's current portfolio, broken down by taxonomy
leaf as a fraction of the total portfolio. The other columns (Retorno último año,
Portafolio Deseado, Retorno esperado) stay blank for the client.

## Critical data-reality finding (why "best-effort + Sin clasificar")

Portfolio data is reliable at the **6 asset-class level** but NOT at the leaf level:
- `Product.asset_class` = list of {name,percentage}; names are the 6 class keys (reliable;
  normalize legacy aliases via `search.py:_is_valid_asset_class` / `categories.ts`).
- `Product.underlying` = list of {name,percentage} but **free-text, unvalidated**. The agent
  default stores the PRODUCT NAME as underlying (prompts.py:125), or abbreviations
  ("RV US Large Cap", "RF Corporate"), or a group name ("Cripto"). No existing leaf→taxonomy map.
- Club deals group+region and most leaves are only present if the LLM wrote the
  `"{group} {leaf}"` composite — not guaranteed.

Decision (user-approved): fill the leaves we can match **with confidence**; NEVER invent a
leaf for amounts we cannot map. Unmapped amounts are reported transparently on a SECOND sheet
**"Sin clasificar (SABBI)"**, reconciling per class: mapped % + unmapped % = class % (reliable).
The template's subtotal/total formulas therefore reflect only confidently-mapped leaves; the
gap is visible on the second sheet, never fabricated into a leaf.

## Approach (fidelity)

Load the template asset with openpyxl, write fractions into the mapped leaf cells, append the
"Sin clasificar (SABBI)" sheet, stream. Verified: openpyxl load→save preserves all 28 merges,
fills, and formulas; leaf cells keep their `0.000%` format, so we write the raw fraction (0–1).
Do NOT rebuild the template cell-by-cell. Do NOT mutate the on-disk asset (load returns an
in-memory copy; save to BytesIO).

## Exact leaf-cell → (asset_class, group, leaf) map (column D)

- Inversiones directas: D17 (RE Perú, Residencial), D18 (RE Perú, Oficinas), D19 (RE Perú, Comercial/Industrial), D21 (RE Extranjero, RE Extranjero).
- Mercados privados: D28 Deuda Privada, D30 Private Equity, D32 Venture Capital, D34 Real Estate, D36 Hedge Funds, D38 Infraestructura.
- Club deals: D45 (Real Estate, Perú), D46 (Real Estate, Extranjero), D48 (Deuda Privada, Perú), D49 (Deuda Privada, Extranjero), D51 (Otros, Perú), D52 (Otros, Extranjero).
- Mercados públicos — Renta Variable: D59 US Large Cap, D60 US Mid & Small Cap, D61 Developed ex-US, D62 EM ex-Perú, D63 Perú. Renta Fija: D65 US Treasuries, D66 IG Corporates AAA-BBB, D67 High Yield BB-, D68 EM Bonds, D69 LatAm Bonds, D70 Perú Bonds.
- Otros: D77 Bitcoin, D78 Ethereum, D79 Otras; D81 Oro, D82 Otros.
- Cash y equivalentes: D89 (single cell) — route the ENTIRE cash class amount here (the two leaves "Depósitos a plazo" + "Fondos de Money Market" collapse into one cell; cash underlying rarely carries leaf detail, so class→cell is safe and NOT a guess).

## Attribution rule

1. `total = sum(p.amount for p in products)` (0 products → return template with empty ACTUAL + empty note). 
2. For each product, for each `asset_class` alloc: `class_amount = amount * pct/100`, key by canonical class key (resolve aliases). 
3. Within a class, for each `underlying` alloc: `leaf_amount = class_amount * pct/100`. Match `underlying.name` to a cell of that class via (in order): exact (accent/case-insensitive) match of leaf, of `"{group} {leaf}"`, of group (single-leaf groups); then a CONSERVATIVE alias map (e.g. "RV "→"Renta Variable ", "RF "→"Renta Fija ", "RE Perú"→group RE Perú). If no confident match → the amount is UNMAPPED. 
4. Cash: the whole `cash_y_equivalentes` class amount → D89, regardless of underlying. 
5. If a product's `underlying` is empty → its whole `class_amount` is UNMAPPED (cannot know the leaf). 
6. Each mapped cell value = `leaf_bucket / total` (fraction). Write into the existing cell (keeps `0.000%`). 
7. UNMAPPED per class accumulates with the offending product names/underlying strings → "Sin clasificar (SABBI)" sheet. NEVER guess a leaf.

"Sin clasificar (SABBI)" sheet columns: Clase de activo | % mapeado | % sin clasificar | % total clase | Detalle (producto — underlying). Plus a short header note explaining these amounts could not be confidently classified and were left out of the ACTUAL column.

## Files

- NEW `apps/backend/src/db/portfolio_template_export.py` — `build_portfolio_template_workbook(products) -> io.BytesIO`, mapping table, matcher + alias map, unmapped collector, `template_export_filename()`.
- Asset `apps/backend/src/db/templates/portafolio_final_template.xlsx` (already copied, byte-identical to the attachment).
- MOD `apps/backend/src/api/routes.py` — repoint `GET /portfolio/me/export` to the new builder + filename. (Leave `db/excel.py` in place for now — unused by the button; removal is a separate follow-up to avoid test churn.)
- NEW `apps/backend/tests/test_portfolio_template_export.py` — unit tests.

Untouched: `product_catalog`, catalog export, the agent, the frontend (the button already calls `/portfolio/me/export`).

## Tasks

- [x] **T-A — Template export module + route repoint (writer, strict TDD).** DONE.
  New `db/portfolio_template_export.py` (LEAF_CELLS table, `_resolve_class`, `_match_leaf`
  with unique-hit rule + RV/RF aliases, note sheet, `build_portfolio_template_workbook`,
  `template_export_filename`). Route repointed. 16 new tests. RED observed
  (`ModuleNotFoundError`), GREEN 22 passed, ruff clean.
- [x] **T-B — Verify + commit.** Orchestrator re-ran 22 tests + ruff, read the module, and
  GENERATED a real workbook to inspect: D59=.4167 (Renta Variable US Large Cap), D28=.25
  (Deuda Privada), D89=.1667 (cash w/ empty underlying → cash cell), D65=.0833 (via "RF"
  alias); formulas (D94) + `0.000%` format preserved; a name-as-underlying product correctly
  landed on "Sin clasificar (SABBI)" (NOT invented into a leaf); reconciliation ties out;
  on-disk asset unmutated. Commit below.

## Acceptance criteria / tests

- Loading the generated workbook: sheet 1 title + all 28 merges + section fills + subtotal/total
  FORMULAS preserved (identical to the template); mapped leaf cells hold the right fractions.
- A product with a cleanly-mapped underlying (e.g. asset_class mercados_publicos, underlying
  "Renta Variable US Large Cap" 100%) lands in D59 as amount/total; "RV US Large Cap" alias too.
- Cash class routes entirely to D89.
- A product whose underlying is the product name / unrecognized → appears on "Sin clasificar
  (SABBI)" with its class, and is NOT written into any leaf cell.
- Reconciliation: for each class, mapped% + unmapped% == class% (within rounding).
- Empty portfolio → valid workbook, ACTUAL blank, note sheet effectively empty.
- `ruff check` clean on new/changed files.

## Progress / evidence

- (pending)

## Next step

Implement T-A (delegated writer, strict TDD). Delivery (push/PR) is the user's call.
