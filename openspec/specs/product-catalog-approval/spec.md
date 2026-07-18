# Product Catalog Approval Specification

## Purpose

Lets admins curate the trusted L1 product catalog (`product_catalog`) from
real investor portfolio data: approve a portfolio product into the catalog
with admin-supplied enrichment fields, reject exact duplicates, and manage
existing catalog entries (list, delete).

## Requirements

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
