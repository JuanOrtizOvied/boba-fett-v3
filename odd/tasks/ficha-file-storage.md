# Feature: Store the uploaded ficha Excel and allow downloading it

- **Feature ID:** `ficha-file-storage`
- **File locator:** `odd/tasks/ficha-file-storage.md`
- **Engram mirror topic:** `odd/ficha-file-storage/tasks`
- **Branch:** `feat/ficha-file-storage` off `main`.
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.
- **Route:** INLINE.

## User request
Save the uploaded Excel (ficha patrimonial .xlsx) and be able to download it later.

## Current state (explored)
- Upload: frontend reads the file as base64 and POSTs `{ file_data }` to
  `/admin/ficha-patrimonial/parse`. `FichaParseRequest` already has `file_name` (unused).
- `parse_ficha_patrimonial` decodes, parses, enriches, and `ficha_repo.create(client, rows)`
  persists the ficha — but the RAW file bytes are NOT stored.
- `ficha` table has no file columns. Deploy uses Alembic (current head: `c7d8e9f0a1b2`).

## Decision: store the bytes in Postgres (bytea) on the `ficha` row
Postgres is the single source of truth and the Docker FS is ephemeral; ficha files are
≤10MB (upload validator). No S3 app-storage is configured. So a `file_data BYTEA` +
`file_name TEXT` on `ficha` is the right fit. Stored at parse time; downloaded via a new
admin endpoint.

## Tasks
- [x] **T-1 — Schema + migration + repository storage.** DONE. INLINE (TDD-integration).
  `schema.sql`: `ficha` += `file_data BYTEA`, `file_name TEXT NOT NULL DEFAULT ''`.
  New Alembic migration (down_revision `c7d8e9f0a1b2`) adding both columns. `FichaRepository.create`
  gains `file_data: bytes | None`, `file_name: str` and stores them; new
  `get_file(ficha_id) -> tuple[str, bytes] | None`. Integration test (CI DB):
  create-with-file → get_file roundtrip. NOTE: integration tests need `TEST_DATABASE_URL`
  (not available locally) — they run in CI.
- [x] **T-2 — Parse stores the file + download endpoint.** DONE. INLINE (TDD). Migration
  head now `e7f8a9b0c1d2`. Endpoint `GET /ficha-patrimonial/fichas/{id}/file` (admin-only,
  404 when absent, Content-Disposition with the original name via `filename*`). Backend
  387 passed / 151 skipped (incl. 2 new get_file integration tests, CI-only); ruff clean.
  `parse_ficha_patrimonial` passes `file_bytes` + `data.file_name` to `create`.
  `GET /admin/ficha-patrimonial/fichas/{id}/file` → the stored `.xlsx` as an attachment
  (Content-Disposition), 404 when absent, admin-only (router dependency). Route tests
  (mocked repo, no DB): download returns the bytes + headers; 404 when `get_file` is None.
- [x] **T-3 — Frontend: download button.** DONE. INLINE (TDD). `page.tsx` already sent
  `file_name: file.name`. Added `fichaApi.downloadFichaFile(id)` (fetch binary with auth →
  blob → anchor download) + `filenameFromDisposition` (prefers RFC 5987 `filename*`). A
  download action per ficha in `FichaSidebar` beside delete, wired to `handleDownloadFicha`
  (shows a friendly error on 404/failure). Tests: 3 api (helper, 404, success) + 1 sidebar
  click. Web suite 186 passed / 18 files; tsc + eslint clean.

## Acceptance criteria
- Uploading a ficha stores its original `.xlsx`; a later download returns the exact file
  with its original name. Older fichas (no stored file) return 404 handled gracefully.
- Admin-only. Backend + web suites green; migration chains cleanly from `c7d8e9f0a1b2`.

## Next step
Feature complete (T-1..T-3). The Alembic migration runs on deploy; only NEW uploads
store their file, so existing fichas download as 404 (handled). Pending (user-owned):
merge/push + deploy (migration).
