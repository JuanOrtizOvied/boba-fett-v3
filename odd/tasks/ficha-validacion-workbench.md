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
  8 pre-existing / 0 new. Commit: `__T3__`.
- [ ] **T-4 — Editable Administradores table.** Admins of the selected series,
  editable. Render + edit tests.
- [ ] **T-5 — Per-line actions + confirm gating.** Aprobar/Descartar line state;
  deferred buttons disabled; confirm posts only approved lines. Update the
  existing confirm tests.

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

Implement T-1 (RED → GREEN). Push / PR are the user's call; this branch stacks
on the v2 PR.
