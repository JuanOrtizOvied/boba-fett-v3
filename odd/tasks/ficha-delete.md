# Feature: Delete a ficha from the sidebar

- **Feature ID:** `ficha-delete`
- **File locator:** `odd/tasks/ficha-delete.md`
- **Engram mirror topic:** `odd/ficha-delete/tasks`
- **Branch:** `feat/ficha-delete` (off `main`).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.

## Objective

Let the admin delete a saved ficha from the sidebar (e.g. empty/test uploads).
Deleting a ficha removes its lines (FK `ON DELETE CASCADE`).

## Tasks

- [x] **T-1 — Delete (backend).** DONE. Route: INLINE. `FichaRepository.delete`
  (`DELETE ... RETURNING id` → bool; lines cascade) + `DELETE
  /admin/ficha-patrimonial/fichas/{id}` (404 when nothing deleted). TDD: RED →
  GREEN. Integration (delete removes ficha+lines, idempotent) + route (delete,
  404) tests. Backend suite 350 passed / 145 skipped / 0 new; ruff clean.
  Commit: `__T1__`.
- [x] **T-2 — Delete (frontend).** DONE. Route: INLINE. `deleteFicha(id)` in
  `fichaApi.ts`; `FichaSidebar` row restructured to a relative wrapper with the
  select `<button>` + a sibling ✕ delete `<button aria-label="Eliminar <name>">`
  (no nested buttons; clicking delete does not select). Page `handleDeleteFicha`
  → `deleteFicha` + list refresh, resetting the review if the open ficha was
  deleted. TDD: RED → GREEN. Tests: sidebar delete (fires onDelete, not onSelect),
  api deleteFicha (DELETE verb/url), page delete (calls deleteFicha). tsc + eslint
  clean. Full web suite 144 passed / 6 pre-existing / 0 new. Commit: `__T2__`.

## Acceptance criteria / checks
- Deleting a ficha removes it (and its lines) and refreshes the sidebar; a
  missing id → 404. 0 new failures vs. base.

## Next step
**COMPLETE** (T-1 backend + T-2 sidebar delete button). Optional follow-up: a
confirm step before delete (currently one-click).
