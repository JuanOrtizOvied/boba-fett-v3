# Feature: Create a client account from the ficha when confirming without a user

- **Feature ID:** `ficha-create-user-on-confirm`
- **File locator:** `odd/tasks/ficha-create-user-on-confirm.md`
- **Engram mirror topic:** `odd/ficha-create-user-on-confirm/tasks`
- **Branch:** `feat/ficha-create-user-on-confirm` off `main`.
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q -p no:recording`
  (the global `vcr`/`urllib3` plugin breaks system python; always use the venv + `-p no:recording`).
  Web `yarn workspace web test`.
- **Route:** DELEGATED DIRECT (writer trigger: 2+ non-trivial files).

## User request
Cuando una ficha patrimonial no tiene usuario asociado (el email no coincidió con
ninguna cuenta), el botón **Confirmar** daba 500. Ya se cubrió el crash con un 400
(ver abajo). El usuario pide que, en ese caso, el flujo **solicite email, nombres y
apellidos** para crear la cuenta y poder confirmar.

## Product decisions (confirmed with user)
1. **Crear cuenta nueva** con ese email cuando la ficha no tiene usuario.
2. **El admin escribe la contraseña** en el mismo formulario (patrón de "Crear usuario").
   No hay envío de emails; rol fijo `user`.
3. Nombres y apellidos se guardan en **columnas nuevas** de `users` (hoy no existen).

## Current state (explored)
- `users` (schema.sql:3-12 / tables.py:27): `id UUID`, `email UNIQUE NOT NULL`,
  `password_hash NOT NULL`, `role`, `created_by`, timestamps, `active_thread_id`.
  **Sin columnas de nombre.**
- `products.user_id` es UUID NOT NULL FK → `users.id`. Confirmar SIEMPRE necesita un user real.
- Confirm endpoint `POST /admin/ficha-patrimonial/confirm` → `confirm_ficha_patrimonial`
  (admin_routes.py ~805): `FichaConfirmRequest{ user_id, products }`.
  **Ya arreglado (fix previo):** `if not data.user_id.strip(): 400` antes de la BD.
- Frontend `ReviewTable.tsx` (handleConfirm ~735): hoy muestra un aviso ámbar cuando
  `userId` vacío y deshabilita Confirmar. `userId` llega como `ficha.user_id ?? ""`
  (page.tsx:123).
- Schema stack: `schema.sql` (dev + tests, via tests/conftest.py:105), `tables.py`
  (SQLAlchemy source of truth), Alembic head `e7f8a9b0c1d2`.
- Existing user creation: `POST /admin/users` → `UserRepository.create(email, password_hash, role, created_by)`;
  `hash_password` en `auth/passwords.py`. Frontend ref: `apps/web/app/admin/users/create/page.tsx`.

## Tasks
- [x] **T-0 — Fix 500 → 400 (DONE, prior change, this branch's base).** Backend rejects
  blank `user_id` with 400 before the DB call; frontend disables Confirmar + amber warning
  when no user. Tests: `test_confirm_empty_user_id_returns_400_without_db_call` (+ whitespace),
  frontend "keeps Confirmar disabled and warns...". NOTE: T-3 REPLACES the amber-warning-only
  UI with the create-client form (the 400 guard stays as the no-form safety net).
- [x] **T-1 — Schema: add `first_name` / `last_name` to `users`.** DONE. DELEGATED.
  `schema.sql`: both added to `users` CREATE (`TEXT NOT NULL DEFAULT ''`) + idempotent
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. `tables.py`: both Columns added. Migration
  `migrations/versions/f8a9b0c1d2e3_add_name_to_users.py` (down_revision `e7f8a9b0c1d2`,
  new head), add/drop both.
- [x] **T-2 — Backend: create-client-on-confirm.** DONE. DELEGATED (TDD).
  - `UserRepository.create`: accept `first_name: str = ""`, `last_name: str = ""`, and a
    `conn` param so it can run inside the confirm transaction (atomic user+products).
  - `FichaConfirmRequest`: add `new_client: NewClientInput | None = None` where
    `NewClientInput{ email, first_name, last_name, password: Field(min_length=8) }`;
    `user_id: str = ""`.
  - Endpoint logic: if `new_client` → `get_by_email`; exists → **409**; else create user
    (inside the products transaction, hashed password, role `user`, created_by = admin id;
    add `admin: dict = Depends(require_admin)`), set target user_id. Elif `user_id.strip()`
    → existing 404 check. Else → **400** (keep T-0 guard). Products created under target id.
  - Unit tests (mocked app, tests/test_ficha_patrimonial_routes.py): no user_id + no
    new_client → 400; new_client with existing email → 409 (mock `get_by_email`).
  - Integration test (PG, tests/integration/test_ficha_patrimonial_pg.py): new_client creates
    the user (with names) + products atomically; invalid product rolls back BOTH (0 users, 0 products).
  - **Verified (parent):** backend `390 passed` (unit, `--ignore=tests/integration`); ruff
    clean on all changed files; `test_auth_repository.py` INSERT assertion updated for the 2
    new columns. Integration tests written, unrun (no local Postgres → CI).
- [x] **T-3 — Frontend: create-client form in the no-user case.** DONE. INLINE (TDD).
  `ReviewTable.tsx`: when `!hasUser`, renders a form (email, contraseña, nombres, apellidos)
  with aria-labels; `newClientComplete` gates Confirmar (email+nombres+apellidos non-empty,
  password ≥ 8) together with ≥1 approved line. `handleConfirm` sends
  `{ user_id: "", new_client: {email, first_name, last_name, password}, products }` when no
  user, else the old `{ user_id, products }`. A 409 detail ("Ya existe un usuario con ese
  email") flows through the existing `extractErrorDetail` error path. No new types needed
  (inline payload). Tests: existing "disabled + warns" still green; new "sends new_client"
  and "409 email-taken message". Web ReviewTable suite 28 passed; tsc + eslint clean.

## Acceptance criteria
- A ficha with no associated user can be confirmed by filling email + nombres + apellidos +
  password: a `user` account is created and the products are created under it, atomically.
- Duplicate email → 409 with a clear message, no account/products created.
- Neither user_id nor new_client → 400 (safety net). Admin-only. Backend + web suites green;
  migration chains cleanly from `e7f8a9b0c1d2`.

## Next step
Feature complete (T-0..T-3). Backend 390 unit passed + 2 CI-only integration tests; web 189
passed; tsc/eslint/ruff clean. Nothing committed yet (branch `feat/ficha-create-user-on-confirm`).
Pending (user-owned): review, commit, push/PR, and deploy — the Alembic migration
`f8a9b0c1d2e3` runs on deploy.
