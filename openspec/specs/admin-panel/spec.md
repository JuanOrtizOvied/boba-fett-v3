# Admin Panel Specification

## Purpose

Read-only administrative oversight: admins browse the user directory, any
user's portfolio, and any user's chat history, without editing other
users' data.

## Requirements

### Requirement: Admin Portfolio Viewing

Admins MUST be able to view, read-only, any user's portfolio.

#### Scenario: Admin views a user's portfolio

- GIVEN an authenticated admin
- WHEN they GET `/admin/portfolios/:userId`
- THEN the response includes that user's products and summary metrics

#### Scenario: Admin lists all portfolios

- GIVEN an authenticated admin
- WHEN they GET `/admin/portfolios`
- THEN the response lists every user with a portfolio summary (total amount, product count)

#### Scenario: Admin cannot mutate another user's portfolio

- GIVEN an authenticated admin viewing user X's portfolio
- WHEN they attempt PATCH or DELETE on user X's products
- THEN the system MUST respond 403

### Requirement: Admin Chat History Viewing

Admins MUST be able to view, read-only, any user's LangGraph chat threads.

#### Scenario: Admin views a user's chat thread

- GIVEN an authenticated admin
- WHEN they request a specific user's thread via the LangGraph thread API
- THEN the message history MUST be returned without allowing the admin to post as that user

#### Scenario: Admin browses a user's thread list

- GIVEN an authenticated admin
- WHEN they GET the thread list for a given `userId`
- THEN they receive that user's threads, ordered by most recent activity

### Requirement: Admin Panel Route Protection

The admin panel MUST be reachable only by authenticated users with the
`admin` role.

#### Scenario: Non-admin redirected from admin routes

- GIVEN a logged-in user with role "user"
- WHEN they navigate to `/admin`
- THEN the frontend MUST redirect them away (e.g. to the portfolio dashboard)

#### Scenario: Unauthenticated access blocked

- GIVEN no valid session
- WHEN a client requests `/admin` or any `/admin/*` API route
- THEN the system MUST respond 401 (API) or redirect to `/login` (frontend)
