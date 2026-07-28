# Delta for product-catalog-approval

## MODIFIED Requirements

### Requirement: Approve Portfolio Product to Catalog

The system MUST let an admin approve a portfolio product into
`product_catalog` by submitting the source product's overlapping fields
(`name`, `asset_class`, `subcategory`) plus admin-supplied enrichment fields
(`geographic_focus`, `underlying`, `commission`, `currency`,
`administrator`, `manager`, `liquidity`, `return_rate`). The system SHOULD
record which source product an approved entry came from, to support
traceability and rollback.
(Previously: overlapping fields were `name`, `category`, `subcategory`; `asset_class` was a separate admin-supplied enrichment field alongside `category`.)

#### Scenario: Admin approves a product with enrichment fields

- GIVEN an authenticated admin viewing a portfolio product
- WHEN they submit an approval request with the product's identifying
  fields and enrichment values
- THEN a new `product_catalog` row is created with those field values

#### Scenario: Approval missing required fields is rejected

- GIVEN an authenticated admin
- WHEN they submit an approval request without `name` or `asset_class`
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
`administrator`, `manager`, `liquidity`, `return_rate`, `subcategory`).
(Previously: comparison set also included a separate `category` field.)

#### Scenario: Exact duplicate rejected regardless of case or spacing

- GIVEN a catalog entry with `name = "Bono Soberano"`
- WHEN an admin submits an approval whose normalized fields all match
- THEN the system MUST reject the insertion with a 409 response and MUST
  NOT create a duplicate row

#### Scenario: Entry differing in one field is not a duplicate

- GIVEN a catalog entry with `commission = "1.5%"`
- WHEN an admin submits an otherwise-identical approval with
  `commission = "2%"`
- THEN the system MUST insert the new catalog row
