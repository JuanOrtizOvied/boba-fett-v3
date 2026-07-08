# Tasks: SABBI Authentication & Authorization

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1130 (PR1 ~250, PR2 ~300, PR3 ~280, PR4 ~300) |
| 400-line budget risk | High (aggregate); each PR individually under 400 |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 (sequential) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved — stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | DB + auth module (hashing, JWT, seed) | PR 1 | Base: main. No API dependency. |
| 2 | API auth + guarded endpoints | PR 2 | Depends on PR 1 (auth module). |
| 3 | Frontend auth (login, guards, cookies) | PR 3 | Depends on PR 2 (endpoints exist). |
| 4 | Admin panel UI | PR 4 | Depends on PR 2 (admin API) + PR 3 (AuthProvider). |

## Phase 1 (PR 1): DB + Auth Module

- [x] 1.1 `db/schema.sql`: add `users`, `refresh_tokens`; `products.portfolio_id`→`user_id`. (Password Hashing)
- [x] 1.2 `auth/__init__.py`: module init.
- [x] 1.3 `auth/passwords.py`: `hash_password`/`verify_password` (bcrypt). (Password stored as hash)
- [x] 1.4 `auth/tokens.py`: create/decode access+refresh tokens. (Login, Refresh Token Lifecycle)
- [x] 1.5 `auth/models.py`: `LoginRequest`, `UserResponse`, `UserCreate`.
- [x] 1.6 `auth/seed.py`: `seed_admin()` from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, idempotent. (Initial Admin Seeding)
- [x] 1.7 `db/models.py`: `Product.portfolio_id`→`user_id`.
- [x] 1.8 `db/repository.py`: all methods use `user_id`.
- [x] 1.9 `db/connection.py`: call `seed_admin()` after schema init.
- [x] 1.10 `pyproject.toml`: add `bcrypt`, `PyJWT`.
- [x] 1.11 pytest: hash/verify, token encode/decode/expiry, seed idempotency (needs 1.3–1.6).

## Phase 2 (PR 2): API Auth + Endpoints

_Depends on Phase 1._

- [x] 2.1 `auth/dependencies.py`: `get_current_user`, 401 on missing/expired. (Access Token Validation)
- [x] 2.2 `auth/dependencies.py`: `require_admin`. (role blocked from admin routes)
- [x] 2.3 `api/auth_routes.py`: login, logout, refresh, me endpoints. (Login, Logout, Refresh, Current User Info)
- [x] 2.4 `api/admin_routes.py`: user CRUD, portfolios, threads read-only. (Admin creates user, User Listing, Portfolio/Chat Viewing)
- [x] 2.5 `api/routes.py`: guard routes; `/portfolio/{id}`→`/portfolio/me`; ownership checks. (Authenticated edit/delete, Ownership Enforcement)
- [x] 2.6 `agent/tools.py`: `_portfolio_id()`→`_user_id()` from `configurable.user_id`. (Portfolio Identity Resolution)
- [x] 2.7 pytest integration: login→cookie→scoped request, admin 403, ownership 403 (needs 2.1–2.6).

## Phase 3 (PR 3): Frontend Auth

_Depends on Phase 2._

- [ ] 3.1 `components/auth/AuthProvider.tsx`: context, `GET /api/auth/me` on mount, `login`/`logout`.
- [ ] 3.2 `app/login/page.tsx`: email/password form → `POST /api/auth/login`. (Successful/Invalid login)
- [ ] 3.3 `middleware.ts`: check `sabbi_access` cookie, redirect `/login`. (Guarded route redirect)
- [ ] 3.4 `app/api/[...path]/route.ts`: route `/auth/*`, forward cookies both ways. (Run Config Injection)
- [ ] 3.5 `lib/usePortfolio.ts`: fetch `/api/portfolio/me`, drop `getPortfolioId`, silent refresh on 401.
- [ ] 3.6 `app/assistant.tsx`: use `configurable.user_id`; set thread `metadata.owner_user_id`. (Thread Ownership)
- [ ] 3.7 `app/page.tsx`: remove `getPortfolioId()`, protect via auth context.
- [ ] 3.8 `app/layout.tsx`: wrap app in `AuthProvider`.
- [ ] 3.9 Delete `lib/portfolioId.ts`. (anonymous flow removed)

## Phase 4 (PR 4): Admin Panel

_Depends on Phase 2 (admin API) and Phase 3 (AuthProvider, middleware)._

- [ ] 4.1 `app/admin/layout.tsx`: sidebar nav, admin-only guard. (Admin Panel Route Protection)
- [ ] 4.2 `app/admin/page.tsx`: user list dashboard. (User Listing)
- [ ] 4.3 `app/admin/users/create/page.tsx`: create-user form → `POST /admin/users`.
- [ ] 4.4 `app/admin/portfolios/page.tsx`: all-portfolios list. (Admin lists all portfolios)
- [ ] 4.5 `app/admin/portfolios/[userId]/page.tsx`: read-only portfolio view. (views portfolio, cannot mutate)
- [ ] 4.6 `app/admin/threads/page.tsx` + viewer: list + read-only thread view. (Chat History Viewing)
