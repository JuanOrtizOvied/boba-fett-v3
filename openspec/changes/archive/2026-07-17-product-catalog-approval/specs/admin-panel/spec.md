# Delta for Admin Panel

## ADDED Requirements

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
