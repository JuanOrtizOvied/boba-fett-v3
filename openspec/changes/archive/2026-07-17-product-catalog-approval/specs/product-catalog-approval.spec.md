# Delta Spec: Product Catalog Approval

> Combined view of this change's domain specs. Canonical per-domain files:
> `specs/product-catalog-approval/spec.md` (new capability) and
> `specs/admin-panel/spec.md` (delta).

## Domain: product-catalog-approval (New Capability)

### Requirement: Approve Portfolio Product to Catalog

The system MUST let an admin approve a portfolio product into
`product_catalog` by submitting the source product's overlapping fields
(`name`, `category`, `subcategory`) plus admin-supplied enrichment fields
(`asset_class`, `geographic_focus`, `underlying`, `commission`, `currency`,
`administrator`, `manager`, `liquidity`, `return_rate`). The system SHOULD
record which source product an approved entry came from, to support
traceability and rollback.

#### Scenario: Admin approves a product with enrichment fields

- GIVEN an authenticated admin viewing a portfolio product
- WHEN they submit an approval request with the product's identifying
  fields and enrichment values
- THEN a new `product_catalog` row is created with those field values

#### Scenario: Approval missing required fields is rejected

- GIVEN an authenticated admin
- WHEN they submit an approval request without `name` or `category`
- THEN the system MUST respond 422 and MUST NOT insert a catalog row

#### Scenario: Non-admin cannot approve

- GIVEN an authenticated user without the `admin` role
- WHEN they call the approval endpoint
- THEN the system MUST respond 403

### Requirement: Duplicate Detection Before Catalog Insertion

The system MUST reject catalog insertion when a candidate entry's
normalized field values (trimmed, case-insensitive) match an existing
`product_catalog` row across every catalog field (`name`, `asset_class`,
`geographic_focus`, `underlying`, `commission`, `currency`,
`administrator`, `manager`, `liquidity`, `return_rate`, `category`,
`subcategory`).

#### Scenario: Exact duplicate rejected regardless of case or spacing

- GIVEN a catalog entry with `name = "Bono Soberano"`
- WHEN an admin submits an approval whose normalized fields all match,
  e.g. `name = "  bono soberano  "`, with every other field identical
- THEN the system MUST reject the insertion with a 409 response and MUST
  NOT create a duplicate row

#### Scenario: Entry differing in one field is not a duplicate

- GIVEN a catalog entry with `commission = "1.5%"`
- WHEN an admin submits an otherwise-identical approval with
  `commission = "2%"`
- THEN the system MUST insert the new catalog row

### Requirement: Catalog Listing

Admins MUST be able to list all `product_catalog` entries.

#### Scenario: Admin views the catalog list

- GIVEN an authenticated admin
- WHEN they GET the catalog listing endpoint
- THEN the response includes every catalog entry with all its fields

### Requirement: Catalog Entry Deletion

Admins MUST be able to delete a catalog entry. Catalog entries MUST NOT be
inline-editable in this version — deletion is the only supported mutation
after approval.

#### Scenario: Admin deletes a catalog entry

- GIVEN an authenticated admin and an existing catalog entry
- WHEN they issue a delete request for that entry's id
- THEN the entry MUST no longer appear in the catalog listing

#### Scenario: Deleted entries drop out of cascade search

- GIVEN a catalog entry has been deleted
- WHEN the agent's L1 cascade search runs afterward
- THEN it MUST NOT return the deleted entry

## Domain: admin-panel (Modified Capability)

### ADDED Requirements

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
