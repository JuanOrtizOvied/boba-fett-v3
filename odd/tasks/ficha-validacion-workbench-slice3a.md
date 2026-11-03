# Feature: Ficha validation workbench — Slice 3a (persistence + status)

- **Feature ID:** `ficha-validacion-workbench` (Slice 3a)
- **File locator:** `odd/tasks/ficha-validacion-workbench-slice3a.md`
- **Engram mirror topic:** `odd/ficha-validacion-workbench/slice3a`
- **Branch:** `feat/ficha-validacion-workbench` (continues Slice 1+2; stacked on `feat/ficha-patrimonial-v2`).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.
- **Predecessors:** Slice 1 (visual) + Slice 2 (signals) COMPLETE.

## Objective

Persist each uploaded ficha and its per-line review decisions so the workbench
survives a reload and (Slice 3b) a left sidebar can list fichas by status.

## Product decision (user-confirmed: "Por decisiones de línea")

Ficha status is derived from the line decisions:
- **con_error** — the parse or enrichment failed.
- **por_validar** — parsed, NO line decided yet.
- **en_proceso** — at least one line decided (approved/discarded), but not all
  decided-and-confirmed.
- **validada** — ALL lines decided AND the ficha was confirmed (products created).

Fichas auto-save on parse (every upload appears in the sidebar).

## Scope

### Slice 3a (this doc)
- Pure `derive_ficha_status(parse_failed, line_statuses, confirmed)` helper (T-1).
- New `ficha` + `ficha_line` tables in `schema.sql` (T-2).
- `FichaRepository`: create-on-parse, update line status, mark confirmed, get,
  list (T-2/T-3). Wire parse→auto-save and the line-status/confirm endpoints (T-3).

### Deferred
- **Slice 3b:** list/filter endpoint consumption + the sidebar UI.
- Full in-progress EDIT-state persistence (name/series edits before confirm) —
  3a persists the parsed rows + enrichment + per-line STATUS; edits re-derive from
  the stored enrichment on reopen. Edit-state persistence is a later refinement.
- **Slice 2b:** flujos + comentarios + Fuentes URLs (need the real Excel).

## Known infra constraints
- Tables live in `schema.sql` (idempotent; `alembic/versions` is empty → alembic
  is a no-op). New tables = `CREATE TABLE IF NOT EXISTS` in `schema.sql`.
- `schema.sql` has the pre-existing fresh-apply bug (`products.geographic_focus`
  default cast); integration tests need the existing-schema test DB (as in v2).

## Tasks

- [x] **T-1 — Ficha status derivation (pure, backend).** DONE. Route: INLINE.
  `derive_ficha_status(parse_failed, line_statuses, confirmed)` in
  `db/ficha_patrimonial.py` + `LINE_DECIDED = ("approved","discarded")`. Encodes:
  parse_failed→con_error; []→por_validar; all pending→por_validar; some decided→
  en_proceso; all decided & confirmed→validada; confirmed-but-not-all-decided→
  en_proceso. TDD: RED (ImportError) → GREEN. `test_ficha_status` 7/7. Backend
  suite 334 passed / 140 skipped / 0 new. Commit: `88c6045`.
- [x] **T-2 — Tables + repository (backend).** DONE. Route: INLINE. Added `ficha`
  (user_id UUID FK nullable, client_*, parse_failed, confirmed, timestamps) +
  `ficha_line` (raw_* fields, `enriched` JSONB, `line_status` CHECK pending/
  approved/discarded, FK + index) to `schema.sql`. New `db/ficha_repository.py`:
  models `Ficha`/`FichaLine`/`FichaListItem` + `FichaRepository` (create-with-lines
  in a txn, get with enriched JSONB round-trip + derived status, update_line_status,
  mark_confirmed, list-by-status). Status computed via `derive_ficha_status`.
  TDD: RED (ModuleNotFoundError) → GREEN. Integration PG `test_ficha_repository_pg`
  3/3 (lifecycle por_validar→en_proceso→validada, parse-failure→con_error,
  list filter) against `boba-fett-backend` (savepoint-isolated; conftest creates
  the new tables via idempotent schema.sql). Backend unit suite 334 passed / 143
  skipped / 0 new. ruff clean. Commit: `__T2__`.
- [ ] **T-3 — Wire endpoints (backend).** Parse auto-saves the ficha; new
  endpoints to update a line's status and to mark confirmed; list endpoint.
- [ ] **(Slice 3b)** sidebar UI + filters — separate doc.

## Acceptance criteria / checks
- `derive_ficha_status` returns the agreed state for every combination.
- A parsed ficha is persisted and reloadable; line decisions persist; status
  reflects the decisions; confirm marks it validada.
- Chat path untouched; backend `pytest -q` + web suite: 0 new failures vs. base.

## Next step
Implement T-1 (RED → GREEN).
