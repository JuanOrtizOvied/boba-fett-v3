# Access Control Specification

## Purpose

Role-based access control (RBAC) enforced across FastAPI routes, the
Next.js proxy, and LangGraph thread access. Two roles: `user` (own data
only) and `admin` (read-only oversight of all data, cannot mutate other
users' resources).

## Requirements

### Requirement: Role-Based Route Protection (Backend)

Every FastAPI portfolio, product, and admin route MUST require a valid
authenticated session; admin-only routes MUST additionally require role
`admin`.

#### Scenario: User role blocked from admin routes

- GIVEN an authenticated user with role "user"
- WHEN they call any `/admin/*` endpoint
- THEN the system MUST respond 403

#### Scenario: Unauthenticated request blocked

- GIVEN no valid access token
- WHEN any protected route is called
- THEN the system MUST respond 401

### Requirement: Ownership Enforcement

Non-admin users MUST only read or mutate resources (products, threads) they
own. Admins MAY read any resource but MUST NOT mutate resources owned by
other users.

#### Scenario: Owner accesses their own resource

- GIVEN a product owned by user A
- WHEN user A requests it
- THEN access is granted

#### Scenario: Non-owner, non-admin denied

- GIVEN a product owned by user A
- WHEN user B (role "user") requests it
- THEN the system MUST respond 403

#### Scenario: Admin denied mutation on another user's resource

- GIVEN a product owned by user A
- WHEN an admin attempts PATCH or DELETE on it
- THEN the system MUST respond 403 — admin access to other users' data is read-only

### Requirement: Frontend Route Guards

Protected frontend routes MUST redirect unauthenticated users to `/login`,
and role-restricted routes (e.g. `/admin`) MUST redirect non-admin users
away.

#### Scenario: Guarded route redirects when unauthenticated

- GIVEN no valid session in the browser
- WHEN the user navigates to `/` (portfolio) or `/admin`
- THEN the app MUST redirect to `/login`

#### Scenario: Non-admin redirected from admin routes

- GIVEN a logged-in user with role "user"
- WHEN they navigate to `/admin`
- THEN the frontend MUST redirect them away (e.g. to the portfolio dashboard)

### Requirement: LangGraph Thread Ownership

Thread access via the proxy MUST be scoped to the thread's owning user,
with admin read-only override.

#### Scenario: Owner loads their thread

- GIVEN a thread owned by user A
- WHEN user A requests it
- THEN it loads normally

#### Scenario: Non-owner, non-admin denied thread access

- GIVEN a thread owned by user A
- WHEN user B (role "user") requests that thread
- THEN the system MUST respond 403

#### Scenario: Admin reads another user's thread read-only

- GIVEN a thread owned by user A
- WHEN an admin requests it via the admin panel
- THEN the thread is returned but the admin cannot post messages as user A
