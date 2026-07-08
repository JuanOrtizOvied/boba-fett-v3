# Proposal: SABBI Authentication & Authorization

## Intent

SABBI currently has no authentication. Portfolio identity is an anonymous client-generated UUID in localStorage (`apps/web/lib/portfolioId.ts`), meaning any browser can generate a new portfolio, portfolios cannot be recovered across devices, and there is no access control. This change introduces email/password authentication, two roles (`user` / `admin`), admin-invite-only registration, and portfolio ownership tied to authenticated users -- enabling multi-user access control, admin oversight of all portfolios/chats, and secure data isolation.

## Scope

### In Scope

- **Users table + auth schema**: `users` table (id, email, password_hash, role, created_by, created_at), session/token storage
- **Password hashing**: bcrypt or argon2 server-side
- **JWT session tokens**: issued on login, validated on every API request (both FastAPI and LangGraph proxy)
- **Login/logout flows**: backend endpoints + frontend pages (login form, redirect on 401)
- **Role-based access control**: `user` (own portfolio/chat only), `admin` (read-only view of all portfolios/chats, manage product catalog, create user accounts)
- **Admin user management**: endpoint to create user accounts (admin-invite-only, no public registration)
- **Portfolio ownership migration**: replace anonymous `portfolio_id` UUID with `user.id` as the foreign key in `products` table
- **Backend middleware**: FastAPI dependency + LangGraph config injection for auth validation and user scoping
- **Frontend auth guards**: protected routes, auth context provider, token storage, 401 redirect
- **Admin panel (minimal)**: user list, create user form, read-only portfolio/chat viewer
- **Proxy auth forwarding**: Next.js API proxy passes JWT to both backends

### Out of Scope

- OAuth / social login (Google, GitHub, etc.)
- Email-based password reset / "forgot password" flow
- Email verification / confirmation
- Multi-factor authentication (MFA/2FA)
- Rate limiting / brute-force protection (separate concern)
- User self-registration
- Admin editing other users' portfolios (explicitly read-only)
- Audit logging / activity trail

## Capabilities

### New Capabilities

- `user-auth`: Authentication (login/logout), JWT token lifecycle, password hashing, session management
- `user-management`: Admin-invite-only user creation, user listing, role assignment
- `admin-panel`: Admin views for user management, read-only portfolio browsing, chat history viewing

### Modified Capabilities

- `portfolio-builder/agent`: Agent tools must receive `user_id` from auth context instead of client-supplied `portfolio_id`; system prompt updated to reflect authenticated user
- `portfolio-builder/dashboard`: Portfolio panel fetches data scoped to authenticated user, no longer uses localStorage UUID
- `portfolio-builder/product-management`: REST CRUD endpoints require auth; ownership enforced server-side
- `configurable-langgraph-backend`: LangGraph run config injects `user_id` from validated JWT instead of client-supplied `portfolio_id`

## Approach

1. **Database layer**: Add `users` table with `id` (UUID PK), `email` (unique), `password_hash`, `role` (enum: user/admin), `created_by` (FK to users), timestamps. Add `user_id` FK column to `products` table, migrate away from `portfolio_id`.
2. **Auth module** (`apps/backend/src/auth/`): Password hashing (bcrypt), JWT encode/decode (PyJWT), FastAPI dependency (`get_current_user`) that extracts and validates the Bearer token.
3. **Auth endpoints** (`apps/backend/src/api/auth_routes.py`): `POST /auth/login` (returns JWT), `POST /auth/logout` (client-side token discard, optional server-side denylist), `GET /auth/me` (current user info).
4. **Admin endpoints** (`apps/backend/src/api/admin_routes.py`): `POST /admin/users` (create user), `GET /admin/users` (list users), `GET /admin/portfolios` (all portfolios, read-only), `GET /admin/portfolios/:userId` (single user's portfolio).
5. **Middleware integration**: FastAPI routes get `Depends(get_current_user)`. LangGraph proxy injects `user_id` into `RunnableConfig["configurable"]` from the validated token, replacing `portfolio_id`.
6. **Frontend auth**: Login page (`/login`), auth context (React Context + JWT in memory/httpOnly cookie), `useAuth` hook, protected route wrapper, replace `getPortfolioId()` with user-scoped identity from auth context.
7. **Proxy update**: Next.js `[...path]/route.ts` forwards auth header (or cookie) to both backend services.
8. **Migration**: Seed an initial admin user via CLI command or env var on first boot. Existing anonymous `portfolio_id` data has no owner to migrate to (no existing users), so a clean cut is acceptable.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/backend/src/db/schema.sql` | Modified | Add `users` table, add `user_id` FK to `products`, drop `portfolio_id` column |
| `apps/backend/src/db/connection.py` | Modified | Schema migration runs new DDL |
| `apps/backend/src/db/repository.py` | Modified | All queries use `user_id` instead of `portfolio_id` |
| `apps/backend/src/auth/` | New | Auth module: password hashing, JWT, FastAPI dependency |
| `apps/backend/src/api/routes.py` | Modified | All endpoints require auth, scoped to user |
| `apps/backend/src/api/auth_routes.py` | New | Login/logout/me endpoints |
| `apps/backend/src/api/admin_routes.py` | New | User CRUD, read-only portfolio/chat access |
| `apps/backend/src/agent/tools.py` | Modified | `_portfolio_id()` becomes `_user_id()`, reads from auth context |
| `apps/backend/src/agent/nodes.py` | Modified | System prompt may include user context |
| `apps/web/lib/portfolioId.ts` | Removed | Replaced by auth-based identity |
| `apps/web/lib/usePortfolio.ts` | Modified | Fetches by authenticated user, no localStorage UUID |
| `apps/web/app/page.tsx` | Modified | Protected route, no anonymous access |
| `apps/web/app/assistant.tsx` | Modified | Passes JWT/auth token instead of `portfolio_id` |
| `apps/web/app/api/[...path]/route.ts` | Modified | Forwards auth credentials to backends |
| `apps/web/app/login/` | New | Login page |
| `apps/web/components/auth/` | New | Auth context, guards, useAuth hook |
| `apps/web/app/admin/` | New | Admin panel pages |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Large scope inflates PR size beyond 400 lines | High | Split into chained PRs: (1) DB + auth module, (2) API auth middleware + endpoints, (3) frontend auth + login, (4) admin panel |
| JWT secret management in dev vs prod | Medium | Use env var `JWT_SECRET`; document rotation procedure |
| LangGraph thread-level auth gap (threads accessible by thread_id) | Medium | Scope thread creation/loading to authenticated user; validate thread ownership on load |
| Breaking change for existing anonymous data | Low | No real users yet; clean migration acceptable. Document the cut. |

## Rollback Plan

1. Revert the `users` table migration (drop table, restore `portfolio_id` column on `products`)
2. Revert backend auth middleware (remove `Depends(get_current_user)` from all routes)
3. Restore `portfolioId.ts` and anonymous UUID flow in frontend
4. Remove login page and auth context from frontend
5. If using chained PRs, revert in reverse order (admin panel -> frontend auth -> API auth -> DB schema)

## Dependencies

- `PyJWT` or `python-jose` — JWT encoding/decoding for Python
- `bcrypt` or `argon2-cffi` — password hashing
- No new frontend dependencies expected (fetch + React Context sufficient)

## Success Criteria

- [ ] Unauthenticated requests to portfolio/chat endpoints return 401
- [ ] Users can log in with email/password and access only their own portfolio and chat
- [ ] Admins can create new user accounts
- [ ] Admins can view (read-only) any user's portfolio and chat history
- [ ] Admins cannot edit other users' portfolios
- [ ] No public registration endpoint exists
- [ ] Anonymous `portfolio_id` localStorage flow is fully removed
- [ ] LangGraph agent tools scope mutations to the authenticated user
- [ ] Initial admin user can be seeded on first deployment

## Resolved Decisions

1. **JWT lifetime and refresh**: Short-lived access tokens (15 min) + refresh tokens. Refresh token stored as httpOnly cookie, access token in memory.
2. **Admin chat history access**: Included in scope. Admin will query the LangGraph thread API to view user chat history (read-only).
3. **Initial admin seeding**: Via environment variables (`ADMIN_EMAIL` + `ADMIN_PASSWORD`) on first boot. Auto-seed if user doesn't exist.
4. **Token storage on frontend**: httpOnly cookies (both access and refresh). Requires the Next.js proxy to forward/set cookies. More secure against XSS.
5. **Existing anonymous data**: Clean cut — drop `portfolio_id`, add `user_id`. No data migration needed (no real users yet).
