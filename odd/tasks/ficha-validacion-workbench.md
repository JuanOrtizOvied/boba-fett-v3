# Feature: Ficha Patrimonial — validation workbench (Slice 1, visual)

- **Feature ID:** `ficha-validacion-workbench`
- **File locator:** `odd/tasks/ficha-validacion-workbench.md`
- **Engram mirror topic:** `odd/ficha-validacion-workbench/tasks`
- **Branch:** `feat/ficha-validacion-workbench` (off `feat/ficha-patrimonial-v2` @ `0d2b0e4` — stacked on the v2 PR because it depends on `series_options`/`catalog_product_code`).
- **TDD mode:** strict (project convention). Web runner: `yarn workspace web test` (single file: `yarn workspace web test <file>`). Backend: `apps/backend/.venv/bin/python -m pytest -q`.

## Objective

Redesign the admin "Ficha Patrimonial" review screen so it matches the target
mockup: a validation workbench where each declared product is shown next to its
enriched data, with editable **Series** and **Administradores** tables, source/
confidence badges, and per-line actions. This Slice 1 is **front-heavy and adds
NO new backend data model** — it renders the data the V2 enrichment already
emits plus frontend-derivable values.

## Product decision (confirmed by user)

- **Purpose = "Reemplaza el flujo actual".** The workbench is a richer validation
  step over the existing `parse → confirm` flow. "Aprobar y crear producto"
  still creates the CLIENT's portfolio `products` on confirm. The V2 catalog
  stays a READ-ONLY enrichment source; nothing here writes to the catalog.
- **Sidebar + ficha persistence deferred to Slice 3.** Slice 1 works on one
  parsed (ephemeral) ficha, like today.

## Scope

### In scope (Slice 1 — visual, existing data only)

- Header **summary bar** with the stats derivable NOW: `productos declarados`
  (row count) and `valor declarado` (sum of `raw_amount`, grouped by currency).
  Stats that need Slice 2/3 data (`ya estaban en la BD`, `investigados`,
  `por decidir`, `flujos`) render as `—` placeholders with the right labels.
- **Product card redesign** (two-column) to match the mockup layout:
  - Left: declared product (`raw_name`, `raw_currency · raw_amount · declara
    raw_return_rate`), source badge, **confidence badge derived on the frontend
    from `primary_source`** (catalog→alta, claude_knowledge→media, web_search→baja).
  - Right: labeled fields `Nombre`, `Gestor`, `Ticker/ISIN`, `Moneda`,
    `Horizonte`, `Clase de activo`, `Foco geográfico`, `Subyacente`. Fields with
    no Slice-1 data source (`Ticker/ISIN`, `Horizonte`) render with the correct
    label but empty/disabled — wired in Slice 2.
  - **Series table (editable):** render `series_options` as rows — `Serie`,
    `TER c/IGV` (`management_fee_ter`), `Flujos mín/máx`, `Rent. mín/máx`,
    `Mínimo USD`. `Cómo se calculó` label present, empty in Slice 1.
  - **Administradores table (editable):** admins of the selected series —
    `Administrador`, `Serie`, `Custodia %`, `Compra %`, `Venta %`, `Mínimo USD`.
  - `Serie del cliente` / `Administrador del cliente` selects (reuse the v2
    picker logic — fills commission/return/administrator on the editable row).
  - Per-line action buttons present: `Aprobar y crear producto`,
    `Es un producto existente`, `Volver a investigar`, `Descartar línea`.
    Slice-1 behavior: Aprobar = include in confirm; Descartar = exclude from
    confirm. `Es existente` / `Volver a investigar` are rendered but DEFERRED
    (disabled with a title) — they need Slice 2/3 backend.
- `Fuentes` section: label present; links wired in Slice 2 (no source URLs yet).
- Confirm still posts `buildConfirmProducts` for the APPROVED (non-discarded)
  lines to `/api/admin/ficha-patrimonial/confirm`.

### Out of scope (later slices)

- **Slice 2 (backend enrichment):** confidence/`dato al`/Fuentes URLs/Horizonte/
  ISIN emission, flujos extraction, similarity surfacing, "ya estaba en la BD".
- **Slice 3 (persistence):** ficha + per-line status tables, list/get/save
  endpoints, the left **sidebar** with status filters.
- Any write to the V2 catalog.

## Tasks

- [x] **T-1 — Summary bar.** DONE. Route: INLINE (harness: no subagents unless
  asked). New pure helper `computeFichaSummary` (`fichaSummary.ts`) +
  `FichaSummaryBar.tsx`; wired into `page.tsx` review state. `productos
  declarados` + `valor declarado` by currency computed; the 4 Slice-2/3 stats
  render labelled with a `—` placeholder. TDD: RED (missing module/component) →
  GREEN. New tests: `ficha-summary.test.ts` 4/4, `ficha-summary-bar.test.tsx`
  2/2. Full web suite 93 passed / 8 pre-existing failures / 0 new (stash-verified
  `ficha-patrimonial-page`'s 2 failures are identical on clean HEAD). tsc clean
  on new files. Commit: `15b1f22`.
- [x] **T-2 — Card header + confidence/source badges.** DONE. Route: INLINE.
  Restructured `ProductCard` into a two-column **declared rail | enriched panel**
  layout (mockup shape): left rail shows the raw declared product (quoted name,
  `formatDeclaredSummary` line "Soles · 10,294 · declara 4.13%", source badge);
  right panel header shows the **confidence badge** (`deriveConfidence` from the
  match source: catalog→alta, claude→media, web→baja, none→sin datos). Pure
  helpers `deriveConfidence` + `formatDeclaredSummary` added to
  `reviewTableShared.ts`. TDD: RED (missing fns / no badge) → GREEN. New tests:
  4 shared (`deriveConfidence` 2, `formatDeclaredSummary` 2) + 1 component
  (`ficha-review-table` 28/28). eslint clean. Full web suite 98 passed / 8
  pre-existing / 0 new. Commit: `1955b5f`.
- [x] **T-3 — Editable Series table.** DONE. Route: INLINE. New `SeriesTable`
  component renders every catalog `series_options` entry as an editable row —
  columns `Serie` (read-only), `TER c/IGV`, `Flujos mín/máx`, `Rent. mín/máx`,
  `Mínimo USD`, `Cómo se calculó`. Catalog fractions shown as plain percent
  values via new `formatFractionValue` (0.0384 → "3.84"); `Mínimo USD` and
  `Cómo se calculó` have no series-level catalog source in Slice 1 and start
  blank. `EditableFichaRow` gains `editableSeries: EditableSeriesRow[]`
  (initialised by `toEditableSeriesRows` in `toEditableRow`); edits are held in
  that state (independent of the existing `Serie/Admin del cliente` picker, which
  stays green). Inputs carry `aria-label="<col> serie <X>"`. `formatFractionAsPercent`
  refactored onto a shared `fractionToPercentNumber` (behaviour unchanged). TDD:
  RED (missing fns / no table) → GREEN. New tests: 4 shared + 1 component
  (`ficha-review-table` 33/33). tsc + eslint clean. Full web suite 103 passed /
  8 pre-existing / 0 new. Commit: `4adf441`.
- [x] **T-4 — Editable Administradores table.** DONE. Route: INLINE. New
  `AdminTable` component flattens every series' administrators into editable rows
  — columns `Administrador`/`Serie` (read-only) + `Custodia %`/`Compra %`/`Venta
  %` (fractions ×100) + `Mínimo USD` (absolute, new `formatPlainNumber`, no ×100).
  `EditableFichaRow` gains `editableAdmins: EditableAdminRow[]` (via
  `toEditableAdminRows` in `toEditableRow`); inputs carry
  `aria-label="<col> <admin> serie <series>"`. TDD: RED → GREEN. New tests: 4
  shared + 1 component (`ficha-review-table` 38/38). tsc + eslint clean. Full web
  suite 108 passed / 8 pre-existing / 0 new. Commit: `796dc3a`.
- [x] **T-5 — Per-line actions + confirm gating.** DONE. Route: INLINE. Added
  `FichaLineStatus` (`pending`/`approved`/`discarded`) + `lineStatus` on
  `EditableFichaRow` (default `pending`), and `selectApprovedRows`. Per-line
  button bar in the card: **Aprobar y crear producto** (→approved, disabled while
  unmapped), **Descartar línea** (→discarded), **Es un producto existente** and
  **Volver a investigar** rendered but DISABLED (Slice 2/3). Bulk **Confirmar**
  now posts ONLY approved lines (`buildConfirmProducts(selectApprovedRows(...))`)
  and is enabled only when ≥1 line is approved; approved/discarded show an
  inline "Aprobada"/"Descartada" tag. Updated the 2 existing confirm-submission
  tests to approve first and rewrote the gating test; removed the now-unused
  `hasUnmappedRow` import. TDD: RED → GREEN. New/updated tests: 2 shared + 3
  component (gating/deferred/discard) → `ficha-review-table.test` 11/11,
  `ficha-review-table-shared` 31/31. tsc + eslint clean. Full web suite 112
  passed / 8 pre-existing / 0 new (`ficha-patrimonial-page` still 2 failed / 5
  passed — confirm-semantics change added no regression). Commit: `6f8132e`.
- [x] **T-6 — Enriched field grid to match the mockup.** DONE (added after live-run
  review). Route: INLINE. Restructured the enriched panel to the mockup's labeled
  layout: confidence badge + "Producto nuevo · dato al —" line, then **Nombre del
  producto · Gestor · Ticker/ISIN · Moneda · Horizonte · Clase de activo · Foco
  geográfico · Subyacente**. Added editable `manager` (Gestor) to `EditableFichaRow`
  (buildConfirmProducts now reads `row.manager`). `Ticker/ISIN` and `Horizonte`
  render with correct labels but DISABLED (Slice 2). **Removed** the standalone
  Comisión / Administrador-free-text / Liquidez / Rent. Min/Max inputs — those
  commercial values now flow ONLY from the `Serie/Administrador del cliente`
  picker (relabeled, moved BELOW the Series/Administradores tables as in the
  mockup); liquidity stays "". TDD: RED → GREEN. Updated the picker test to assert
  via the confirm payload (commission "3.84%", administrator "Admin Co",
  return_rate "5% - 8%"); updated the editable-fields test; added Gestor-editable
  and deferred-fields tests. `ficha-review-table.test` 13/13,
  `ficha-review-table-shared` 31/31. tsc + eslint clean. Full web suite 114 passed
  / 8 pre-existing / 0 new (`ficha-patrimonial-page` still 2 failed / 5 passed).
  Commit: `c34914c`.

### Known Slice-1 limitation (from live run)

The confidence badge derives purely from match source (catalog→alta). The live
probe showed the ficha fuzzy match (`similarity > 0.1`) yields weak false
positives (~0.136) that still render "Confianza alta". Surfacing `similitud %`
and gating confidence by it is a **Slice 2** item (see Engram:
"Ficha V2 fuzzy match: 0.1 threshold yields false positives").

## Acceptance criteria / checks

- The review screen's structure matches the mockup: summary bar, two-column
  card, editable Series and Administradores tables, client serie/admin selects,
  per-line actions.
- All data shown comes from existing V2 enrichment output or frontend
  derivation — NO new backend field is added in Slice 1.
- Deferred fields/buttons render with correct labels but are inert.
- `yarn workspace web test`: 0 new failures vs. the branch base (the 4
  pre-existing stale web files remain the known follow-up).
- Backend untouched in Slice 1 → backend suite unchanged.

## Progress / evidence

- (pending — updated per task with commit hashes)

## Next step

**Slice 1 COMPLETE** (T-1..T-6 all done, committed on `feat/ficha-validacion-workbench`).
The review screen now matches the mockup's structure (summary bar, declared rail +
confidence, editable Series & Administradores tables, client serie/admin picker,
per-line actions, enriched field grid) using only existing V2 data + frontend
derivation. Next: **Slice 2** (backend — confidence/similitud/Fuentes/Horizonte/
ISIN/flujos, "ya estaba en la BD") and **Slice 3** (persistence + sidebar).
Push / PR are the user's call; this branch stacks on the v2 PR.
