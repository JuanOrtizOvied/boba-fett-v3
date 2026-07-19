# Portfolio Versioning: Snapshot Comparison

## Requirements

### CMP-001: Compare Two Snapshots
**Priority**: Must
**Description**: `GET /portfolio/me/snapshots/compare?a=:id&b=:id` MUST return a structured diff between snapshot `a` (baseline) and snapshot `b` (comparison), both owned by the authenticated user.

#### Scenarios

**Scenario: Investor compares two of their own snapshots**
- Given: an authenticated investor with snapshots "Q2 Review" (a) and "Q3 Review" (b)
- When: they call `GET /portfolio/me/snapshots/compare?a=<Q2_id>&b=<Q3_id>`
- Then: the response is `200` with a structured diff object containing `added`, `removed`, and `modified` product lists plus summary totals (e.g. `total_amount_delta`, `product_count_delta`)

**Scenario: Missing query parameter**
- Given: an authenticated investor
- When: they call `GET /portfolio/me/snapshots/compare?a=<id>` without `b`
- Then: the system responds `422`

**Scenario: Comparing a snapshot the user does not own**
- Given: snapshot `a` belongs to user A and snapshot `b` belongs to user B
- When: user A calls the compare endpoint with `a=<A's id>&b=<B's id>`
- Then: the system responds `403` or `404` and no diff is computed across users' data

**Scenario: Comparing a non-existent snapshot id**
- Given: `a` references a valid snapshot but `b` references an id that does not exist
- When: the compare endpoint is called
- Then: the system responds `404`

### CMP-002: Diff Classification by Stable Product ID
**Priority**: Must
**Description**: The comparison MUST classify each product as `added` (present in `b`, absent in `a`), `removed` (present in `a`, absent in `b`), or `modified` (present in both, at least one field differs) — matched by the stable `product_id`, never by product name. A product deleted and later re-created with the same name (different `product_id`) MUST be classified as one `removed` entry and one `added` entry, not as `modified`.

#### Scenarios

**Scenario: Product added between snapshots**
- Given: snapshot "a" has 5 products and snapshot "b" has those same 5 plus a new one with a `product_id` not present in "a"
- Then: the diff's `added` list contains exactly that one new product

**Scenario: Product removed between snapshots**
- Given: snapshot "a" has a product "prod_xyz" and snapshot "b" does not include "prod_xyz"
- Then: the diff's `removed` list contains "prod_xyz" with its state as captured in "a"

**Scenario: Product modified between snapshots**
- Given: "prod_abc" exists in both "a" and "b" with a different `amount`
- Then: the diff's `modified` list contains "prod_abc" with both its "a" and "b" states

**Scenario: Same-name re-creation is not treated as a modification**
- Given: snapshot "a" has "prod_111" named "Fund X", which was later deleted and a new product "prod_222" also named "Fund X" was created before snapshot "b"
- When: comparing "a" and "b"
- Then: the diff shows "prod_111" in `removed` and "prod_222" in `added` — it MUST NOT be merged into a single `modified` entry matched by name

**Scenario: Unchanged product is excluded from the diff**
- Given: "prod_def" exists in both "a" and "b" with identical field values
- Then: "prod_def" does not appear in `added`, `removed`, or `modified`

### CMP-003: Per-Field Delta for Modified Products
**Priority**: Must
**Description**: For each product in the `modified` list, the response MUST include a per-field delta identifying exactly which fields changed and their before/after values — at minimum `amount`, `category`, `subcategory`, `provider`, and `composition`.

#### Scenarios

**Scenario: Amount-only change**
- Given: "prod_abc" has `amount = 100000` in "a" and `amount = 130000` in "b", all other fields identical
- Then: its per-field delta shows only `amount: {before: 100000, after: 130000}`; no other field appears in the delta

**Scenario: Composition change**
- Given: "prod_abc" has `composition = [{"name": "Debt", "percentage": 100}]` in "a" and `composition = [{"name": "Debt", "percentage": 60}, {"name": "Equity", "percentage": 40}]` in "b"
- Then: its per-field delta includes a `composition` entry showing the before and after allocation lists

**Scenario: Category change moves a product across sections**
- Given: "prod_abc" has `category = "Mercados Privados"` in "a" and `category = "Club Deals"` in "b"
- Then: its per-field delta includes `category: {before: "Mercados Privados", after: "Club Deals"}`

**Scenario: Multiple simultaneous field changes**
- Given: "prod_abc" differs in both `amount` and `provider` between "a" and "b"
- Then: its per-field delta includes both `amount` and `provider` entries

### CMP-004: Comparison View UI
**Priority**: Must
**Description**: The frontend MUST render the comparison as a full-width modal or slide-over showing the two snapshots' products with color-coded diff indicators: green for added, red for removed, yellow/amber for modified — per the proposal's Technical Approach.

#### Scenarios

**Scenario: Investor opens comparison from the snapshot timeline**
- Given: the investor has selected two snapshots in the timeline view
- When: they trigger "Compare"
- Then: a modal or slide-over opens showing products grouped by diff status, with added products in a green-accented row/section, removed in red, and modified in yellow/amber

**Scenario: Modified product shows field-level deltas inline**
- Given: the comparison view is open and a product is `modified`
- When: the investor views that product's row
- Then: the specific changed fields (e.g. amount before → after) are visibly called out, not just a generic "changed" label

**Scenario: No differences found**
- Given: two snapshots with identical materialized product sets
- When: the investor compares them
- Then: the comparison view shows an explicit "no changes" state rather than three empty sections with no explanation

### CMP-005: Comparison Error Handling
**Priority**: Must
**Description**: The compare endpoint and UI MUST surface clear error states for invalid input, matching REST conventions used elsewhere in the API (`404` for not-found, `403` for unauthorized cross-user access, `422` for malformed input).

#### Scenarios

**Scenario: Malformed snapshot id**
- Given: a syntactically invalid UUID passed as `a` or `b`
- When: the compare endpoint is called
- Then: the system responds `422`

**Scenario: Frontend surfaces a compare error to the user**
- Given: the compare request fails (e.g. `404`)
- When: the comparison view attempts to load
- Then: the UI shows an error message instead of a blank or partially-rendered diff

### CMP-006: Comparing a Snapshot to Itself
**Priority**: Should
**Description**: Comparing a snapshot to itself (`a == b`) MUST succeed and return a diff with empty `added`, `removed`, and `modified` lists — it is a valid (if degenerate) input, not an error.

#### Scenarios

**Scenario: Self-comparison returns a no-op diff**
- Given: a valid snapshot id `s`
- When: `GET /portfolio/me/snapshots/compare?a=s&b=s` is called
- Then: the response is `200` with `added: []`, `removed: []`, `modified: []`, and zero deltas

### CMP-007: Comparison Order Reflects Baseline vs. Comparison Semantics
**Priority**: Should
**Description**: The `a` parameter MUST be treated as the baseline (older/reference state) and `b` as the comparison (newer/target state) for the purposes of `before`/`after` labeling in per-field deltas — regardless of the snapshots' actual `created_at` order, so callers can intentionally compare in either chronological direction.

#### Scenarios

**Scenario: Comparing a newer snapshot against an older one, reversed**
- Given: snapshot "Q3" was created after "Q2"
- When: the caller requests `a=<Q3_id>&b=<Q2_id>` (newer as baseline)
- Then: `before` values in the diff come from "Q3" and `after` values come from "Q2" — the endpoint does not silently reorder by `created_at`
