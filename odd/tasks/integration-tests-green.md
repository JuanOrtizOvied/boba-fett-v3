# Feature: restore the integration-test signal (clean DB + stale fixes)

- **Feature ID:** `integration-tests-green`
- **File locator:** `odd/tasks/integration-tests-green.md`
- **Engram mirror topic:** `boba-fett-v3/testing/integration-db`
- **Branch:** `feat/ficha-catalog-curation`.
- **Run:** `TEST_DATABASE_URL=postgresql://admin:pass@localhost:5432/boba-fett-test
  apps/backend/.venv/bin/python -m pytest tests/integration/`.

## Objective

The integration suite (the safety net for the DB-writing code: curation,
series/admins, history, audit log) was red. Make it trustworthy again, without
masking real problems.

## Findings
- **17 failures = polluted DB.** Tests ran against `boba-fett-backend`, which we
  seeded with 333 V2 `catalog_product` rows for manual testing; savepoint
  isolation rolls back per-test writes but not pre-seeded rows, so fixed codes
  (`BD-00001`…) collided (`duplicate key catalog_product_code_key`). Fix: run
  against a dedicated clean DB `boba-fett-test`. Documented in `CLAUDE.md`
  troubleshooting.
- **13 remaining = pre-existing stale tests**, unrelated to the ficha/catalog
  work, in 3 groups:
  1. **Encryption (10).** `amount` and the change-log `before_state`/`after_state`
     are Fernet-encrypted when `ENCRYPTION_KEY` is set (loaded from `.env`).
     Tests read the raw column and did `float(...)` / `json.loads(...)` on the
     ciphertext. No real regression (the model keeps `Field(gt=0)`; `add_product`
     now catches the `ValidationError` and returns `{"status":"error"}`).
  2. **Versioning isolation (2).** `nested transaction has a different isolation
     level: repeatable_read != read_committed`.
  3. **Chat (1).** `test_new_thread_returns_empty_messages` shape assertion.

## Tasks
- [x] **T-1 — Clean-DB convention.** DONE. Route: INLINE. `CLAUDE.md`
  troubleshooting row: integration tests run against a dedicated clean DB, never
  a seeded one; `createdb boba-fett-test`; `conftest` auto-applies `schema.sql`.
  Clean DB: 30 → 13 failures.
- [x] **T-2 — Encryption-aware assertions (10).** DONE. Route: INLINE.
  `test_tools_pg.py` + `test_routes_pg.py`: `decrypt_amount(row["amount"])`
  instead of `float(...)`. `test_repository_audit_pg.py`: `_jsonb` now delegates
  to `decrypt_json` (bidirectional: plain JSONB, plaintext, or ciphertext).
  `test_add_product_rejects_non_positive_amount`: assert the tool's error result
  instead of `pytest.raises(ValidationError)` (add_product catches it). Removed
  now-unused imports. 33/33 across the three files; ruff: no new F-codes
  (pre-existing E501 in these long-dict test lines left as-is; the pre-commit
  hook only lints `src/**`).
- [x] **T-3 — Versioning isolation (2).** DONE. Route: INLINE. `db/versioning.py`
  `_repeatable_read_transaction` now checks `conn.is_in_transaction()` UPFRONT:
  inside an outer transaction (test harness) it opens a plain nested savepoint;
  a freshly-acquired production pool conn is never in a transaction, so it still
  gets real `REPEATABLE READ` — behavior preserved, and the fragile
  try/except-on-`tx.start()` fallback is gone. Fixing the isolation error then
  exposed a second, legitimate behavior: `create_snapshot` raises
  `SnapshotUnchangedError` when the portfolio is unchanged since the last
  snapshot. `test_list_snapshots_orders_newest_first` /
  `_respects_limit_and_offset` snapshotted an unchanged (empty) portfolio
  repeatedly; fixed by adding a distinct product before each snapshot. Versioning
  29/29; ruff clean.
- [x] **T-4 — Chat thread shape (1).** DONE. Route: INLINE.
  `ThreadStateResponse` has an intentional `created_at: str | None = None` field;
  `test_new_thread_returns_empty_messages` predated it. Updated the assertion to
  `{"thread_id", "messages": [], "created_at": None}`.

## Checks / evidence
- After T-1+T-2: integration **146 passed / 3 failed** (clean DB), down from 30.
- After T-3+T-4: integration **149 passed / 0 failed**; FULL backend suite (unit +
  integration) **513 passed / 0 failed** against the clean DB. ruff clean on the
  one `src/` change (`versioning.py`).

**FEATURE COMPLETE:** the integration suite is green again, with no real behavior
masked (the one production-code change preserves production isolation; every
other fix updates stale test expectations to the current, correct contract).
