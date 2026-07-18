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

Admins MUST be able to view, read-only, users' FastAPI-backed chat threads.

#### Scenario: Admin views a user's chat thread

- GIVEN an authenticated admin
- WHEN they request a specific user's thread via the admin chat-history API
- THEN the message history MUST be returned without allowing the admin to post as that user

#### Scenario: Admin browses a user's thread list

- GIVEN an authenticated admin
- WHEN they GET the admin thread list
- THEN they receive users' active chat threads, ordered by most recent activity available to the system

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

### Requirement: Admin Catalog Navigation Entry

The admin panel navigation MUST include a link to the catalog management
page (`/admin/catalog`).

#### Scenario: Admin sees the catalog nav link

- GIVEN an authenticated admin viewing any `/admin/*` page
- WHEN the admin layout renders
- THEN a "Catalog" navigation link to `/admin/catalog` MUST be visible

### Requirement: Approve to Catalog Affordance on Portfolio View

Admin portfolio view pages MUST show an "Approve to catalog" action on
each product card. Selecting it MUST open a form pre-filled with the
product's overlapping fields (`name`, `category`, `subcategory`) and
empty enrichment fields for the admin to complete before confirming.

#### Scenario: Admin opens the approval form

- GIVEN an admin viewing a user's portfolio at `/admin/portfolios/:userId`
- WHEN they select "Approve to catalog" on a product card
- THEN a form opens pre-filled with that product's overlapping fields

#### Scenario: Admin confirms approval

- GIVEN the approval form is open with enrichment fields filled in
- WHEN the admin confirms
- THEN the system MUST call the approval endpoint and MUST show the
  result (success or duplicate rejection) to the admin

#### Scenario: Admin cancels without side effects

- GIVEN the approval form is open
- WHEN the admin cancels
- THEN no catalog entry MUST be created and the form MUST close
