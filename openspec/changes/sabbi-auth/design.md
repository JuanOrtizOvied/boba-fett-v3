# Design: SABBI Authentication & Authorization

## Technical Approach

Add JWT-based authentication with httpOnly cookies, two roles (user/admin), and admin-invite-only registration. The Next.js proxy forwards cookies transparently to both backends. FastAPI validates JWTs via dependency injection. LangGraph tools receive `user_id` from `RunnableConfig["configurable"]` (set by the frontend from the auth context, validated by the backend in production via LangGraph auth handler). Clean cut: `products.portfolio_id` becomes `products.user_id`.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Password hashing | `bcrypt` | argon2-cffi | Battle-tested, pure-wheel install, sufficient for admin-invite-only system. argon2 adds C build deps for marginal gain at this scale. |
| JWT library | `PyJWT` | python-jose | python-jose is unmaintained. PyJWT is the active standard. |
| Token transport | httpOnly cookies (`sabbi_access`, `sabbi_refresh`) | Bearer header + localStorage | httpOnly cookies immune to XSS. Proxy already forwards all headers/cookies transparently. |
| Refresh token storage | Server-side `refresh_tokens` table (hashed) | Stateless refresh JWTs | Enables rotation-on-use, per-user revocation, and admin logout-all. |
| CSRF protection | `SameSite=Lax` + `Origin` header check | Double-submit cookie | All mutations use `fetch()` (not form submissions). SameSite=Lax blocks cross-origin cookie sends. Origin check catches edge cases. |
| LangGraph user scoping | `configurable.user_id` from frontend + LangGraph auth handler in prod | Proxy body rewriting | Minimal change from current `configurable.portfolio_id` pattern. Proxy body parsing for streaming requests is fragile. LangGraph Platform auth handler validates JWT and enforces match in production. Dev trusts configurable (local only). |
| Thread ownership | Thread `metadata.owner_user_id` | Separate DB table | LangGraph SDK supports metadata-based `threads.search()` filtering natively. No extra schema. |
| Route protection | Next.js `middleware.ts` | Layout-level guards | Middleware runs server-side before render, prevents flash of protected content. Falls back to 401 redirect on expired tokens. |
| Frontend user identity | `/api/auth/me` on mount (cookie-based) | Token decode in browser | httpOnly cookies are opaque to JS. `GET /me` is the only way to get user info. |
| Portfolio REST routes | `GET /portfolio/me` (user from cookie) | Keep `/{portfolio_id}` path param | Avoids leaking user_id in URLs. Backend resolves user from JWT. Admin uses `/admin/portfolios/{user_id}`. |

## Data Flow

```
Browser ──cookie──→ Next.js Proxy ──cookie──→ FastAPI (/auth, /portfolio)
                         │                         │
                         │──cookie──→ LangGraph (:2024)
                         │              │
                         │         configurable.user_id
                         │              │
                         │         agent tools → ProductRepo(user_id) → Postgres
                         │
                    middleware.ts
                    (cookie exists? → /login redirect)
```

Login flow: `POST /api/auth/login` → FastAPI validates credentials → sets `sabbi_access` + `sabbi_refresh` httpOnly cookies on response → proxy forwards `Set-Cookie` headers to browser.

Refresh flow: `POST /api/auth/refresh` → FastAPI reads `sabbi_refresh` cookie → validates against `refresh_tokens` table → deletes old token → issues new pair → sets new cookies.

## Database Schema

```sql
-- New tables
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Migration: products.portfolio_id → products.user_id
ALTER TABLE products DROP COLUMN portfolio_id;
ALTER TABLE products ADD COLUMN user_id UUID NOT NULL REFERENCES users(id);
DROP INDEX IF EXISTS idx_products_portfolio;
CREATE INDEX idx_products_user ON products(user_id);
```

Note: since no real users exist yet, the schema.sql will be rewritten (not migrated). The ALTER statements above document the logical change.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/src/db/schema.sql` | Modify | Add `users`, `refresh_tokens` tables; change `products.portfolio_id` → `user_id` |
| `apps/backend/src/auth/__init__.py` | Create | Auth module init |
| `apps/backend/src/auth/passwords.py` | Create | `hash_password()`, `verify_password()` using bcrypt |
| `apps/backend/src/auth/tokens.py` | Create | `create_access_token()`, `create_refresh_token()`, `decode_access_token()`, refresh token hash/verify |
| `apps/backend/src/auth/dependencies.py` | Create | FastAPI `get_current_user`, `require_admin` dependencies |
| `apps/backend/src/auth/models.py` | Create | `LoginRequest`, `UserResponse`, `UserCreate` Pydantic models |
| `apps/backend/src/auth/seed.py` | Create | `seed_admin()` — reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars, creates admin if not exists |
| `apps/backend/src/api/auth_routes.py` | Create | Login, logout, refresh, me endpoints |
| `apps/backend/src/api/admin_routes.py` | Create | User CRUD, portfolio view, thread listing (read-only) |
| `apps/backend/src/api/routes.py` | Modify | Add auth deps to all routes; change `/portfolio/{portfolio_id}` → `/portfolio/me` |
| `apps/backend/src/db/models.py` | Modify | `Product.portfolio_id` → `Product.user_id` |
| `apps/backend/src/db/repository.py` | Modify | All methods: `portfolio_id` → `user_id` |
| `apps/backend/src/db/connection.py` | Modify | Call `seed_admin()` after schema init |
| `apps/backend/src/agent/tools.py` | Modify | `_portfolio_id()` → `_user_id()`, reads `configurable.user_id` |
| `apps/backend/pyproject.toml` | Modify | Add `bcrypt`, `PyJWT` dependencies |
| `apps/web/middleware.ts` | Create | Check `sabbi_access` cookie; redirect to `/login` if missing |
| `apps/web/components/auth/AuthProvider.tsx` | Create | React context: calls `/api/auth/me` on mount, provides `user`, `login()`, `logout()` |
| `apps/web/app/login/page.tsx` | Create | Email/password form, POST to `/api/auth/login` |
| `apps/web/app/page.tsx` | Modify | Remove `getPortfolioId()`, get user from auth context |
| `apps/web/app/assistant.tsx` | Modify | Replace `configurable.portfolio_id` with `configurable.user_id` from auth context |
| `apps/web/lib/usePortfolio.ts` | Modify | Fetch `/api/portfolio/me` (no portfolioId param), remove `getPortfolioId` import |
| `apps/web/lib/portfolioId.ts` | Delete | Replaced by auth-based identity |
| `apps/web/app/api/[...path]/route.ts` | Modify | Add `/auth/` to path routing; ensure cookies forwarded on responses |
| `apps/web/app/admin/layout.tsx` | Create | Admin layout with nav sidebar |
| `apps/web/app/admin/page.tsx` | Create | Dashboard: user list |
| `apps/web/app/admin/users/create/page.tsx` | Create | Create user form |
| `apps/web/app/admin/portfolios/page.tsx` | Create | All portfolios list |
| `apps/web/app/admin/portfolios/[userId]/page.tsx` | Create | Single portfolio view (read-only) |
| `apps/web/app/admin/threads/page.tsx` | Create | Thread list |
| `apps/web/app/layout.tsx` | Modify | Wrap with `AuthProvider` |

## Interfaces / Contracts

```python
# Auth endpoints
POST /auth/login     Body: {email, password}  → Sets cookies, returns {user}
POST /auth/logout    Cookie: sabbi_refresh     → Clears cookies, deletes token
POST /auth/refresh   Cookie: sabbi_refresh     → Rotates tokens, sets new cookies
GET  /auth/me        Cookie: sabbi_access      → {id, email, role}

# Admin endpoints (require_admin)
GET    /admin/users                → [{id, email, role, created_at}]
POST   /admin/users                → Body: {email, password, role}
GET    /admin/portfolios           → [{user_id, email, product_count, total}]
GET    /admin/portfolios/{user_id} → {products: [...]}
GET    /admin/threads              → [{thread_id, user_id, created_at}]
GET    /admin/threads/{thread_id}  → {messages: [...]}

# JWT access token claims
{sub: user_id, email: str, role: str, exp: int, iat: int, type: "access"}
```

```typescript
// Frontend auth context
interface AuthContext {
  user: { id: string; email: string; role: "user" | "admin" } | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Password hashing, JWT encode/decode, token rotation | pytest with mocked DB |
| Unit | Auth dependencies (valid token, expired, missing, wrong role) | pytest with FastAPI TestClient |
| Integration | Login → cookie set → authenticated request → data scoped to user | pytest with real DB (test container or SQLite) |
| Integration | Refresh rotation, logout invalidation | pytest with real DB |
| E2E | Login → portfolio visible → logout → redirect | Manual or Playwright (if added later) |

## Migration / Rollout

Clean cut — no data migration needed (no real users). Schema.sql is rewritten with all tables. On first boot, `seed_admin()` creates the admin user from `ADMIN_EMAIL` + `ADMIN_PASSWORD` env vars. Existing `products` rows with `portfolio_id` are dropped (dev data only).

Environment variables to add: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

## Chained PR Boundaries

| PR | Scope | Key Files | Est. Lines |
|----|-------|-----------|------------|
| 1: DB + Auth Module | users/refresh_tokens tables, bcrypt/PyJWT, password hashing, token encode/decode, admin seed, models migration | `schema.sql`, `auth/*`, `db/models.py`, `db/repository.py`, `pyproject.toml` | ~250 |
| 2: API Auth + Endpoints | FastAPI deps, auth routes, admin routes, existing routes guarded, agent tools user_id | `auth/dependencies.py`, `api/auth_routes.py`, `api/admin_routes.py`, `api/routes.py`, `agent/tools.py` | ~300 |
| 3: Frontend Auth | AuthProvider, login page, middleware, proxy cookie routing, usePortfolio/assistant migration, remove portfolioId.ts | `AuthProvider.tsx`, `login/page.tsx`, `middleware.ts`, `route.ts`, `usePortfolio.ts`, `assistant.tsx` | ~280 |
| 4: Admin Panel | Admin layout, user management, portfolio viewer, thread viewer | `admin/**` pages | ~300 |

## Open Questions

- [ ] LangGraph Platform auth handler: exact API depends on LangGraph Platform version at deploy time. Design the handler interface now; adapt to actual SDK at implementation.
- [ ] Password minimum length: 8 chars (NIST 800-63B). Confirm no stricter policy is needed.
