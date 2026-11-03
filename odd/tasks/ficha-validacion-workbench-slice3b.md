# Feature: Ficha validation workbench — Slice 3b (sidebar + persistence wiring)

- **Feature ID:** `ficha-validacion-workbench` (Slice 3b)
- **File locator:** `odd/tasks/ficha-validacion-workbench-slice3b.md`
- **Engram mirror topic:** `odd/ficha-validacion-workbench/slice3b`
- **Branch:** `feat/ficha-validacion-workbench`.
- **TDD mode:** strict. Web `yarn workspace web test`.
- **Predecessor:** Slice 3a (persistence endpoints) COMPLETE.

## Objective

Add the left **sidebar** of the mockup (list fichas by status, upload, select to
load) and wire the review table's per-line decisions to the Slice-3a persistence
endpoints, so the workbench matches the full mockup.

## Scope

- Consume the Slice-3a endpoints: `GET /admin/ficha-patrimonial/fichas` (+ status
  filter), `GET .../fichas/{id}`, `PATCH .../lines/{line_id}`, `POST
  .../fichas/{id}/confirm`.
- Sidebar: client name + counts + timestamp + status badge; filter tabs (Por
  validar / En proceso / Validadas / Con error / Todas); "Subir ficha (.xlsx)".
- Selecting a ficha loads it (GET) into the review pane; two-pane layout.
- Per-line Aprobar/Descartar persist via PATCH; Confirmar also POSTs confirm.

## Tasks

- [x] **T-1 — API client + TS types.** DONE. Route: INLINE. Added TS types
  `FichaStatus` / `LineStatus` / `FichaLine` / `Ficha` / `FichaListItem`
  (`portfolio-types.ts`, mirroring `db.ficha_repository`) + `lib/fichaApi.ts`:
  `listFichas(status?)`, `getFicha(id)`, `updateLineStatus(lineId, status)`,
  `confirmFicha(id)` — thin `fetchWithAuth` wrappers, throw on non-ok. TDD: RED
  (module missing) → GREEN. `ficha-api.test` 6/6. tsc + eslint clean. Full web
  suite 127 passed / 8 pre-existing / 0 new. Commit: `e924771`.
- [x] **T-2 — FichaSidebar component.** DONE. Route: INLINE. `FichaSidebar.tsx`:
  header + "Subir ficha (.xlsx)" button, filter tabs (Por validar / En proceso /
  Validadas / Con error / Todas) with active highlight, and a row per ficha
  (name, "N productos · fecha", status badge) that is selectable (`aria-current`
  on the active row). Pure component (data + callbacks: fichas, activeFilter,
  selectedId, onFilterChange, onSelect, onUpload). `FichaFilter` type exported.
  TDD: RED → GREEN. `ficha-sidebar.test` 5/5. tsc + eslint clean. Full web suite
  132 passed / 8 pre-existing / 0 new. Commit: `__T2__`.
- [ ] **T-3 — Page wiring.** Two-pane layout; fetch the list; selecting a ficha
  loads it (GET) into the review pane; refresh the list after an upload.
- [ ] **T-4 — Persist per-line decisions.** Approve/Discard call PATCH; Confirmar
  calls POST confirm; optimistic update of the sidebar status.

## Acceptance criteria / checks
- The sidebar lists saved fichas, filters by status, and loads a ficha on click.
- Per-line decisions persist (PATCH) and confirm marks the ficha validada.
- `yarn workspace web test`: 0 new failures vs. the branch base.

## Next step
Implement T-1 (RED → GREEN).
