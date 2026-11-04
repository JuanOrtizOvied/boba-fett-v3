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
- [ ] **T-2 — Delete (frontend).** `deleteFicha(id)` in `fichaApi.ts`; a delete
  (✕) button per sidebar row that calls `onDelete(id)` without selecting the row;
  page wires it to `deleteFicha` + list refresh, clearing the review if the
  deleted ficha was open. Component + api + page tests.

## Acceptance criteria / checks
- Deleting a ficha removes it (and its lines) and refreshes the sidebar; a
  missing id → 404. 0 new failures vs. base.

## Next step
Implement T-1 (RED → GREEN).
