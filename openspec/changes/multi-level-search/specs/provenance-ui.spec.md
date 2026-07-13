# Delta for portfolio-builder/product-management — Source Reliability UI

## ADDED Requirements

### Requirement: Provenance Data Contract

`propose_product` MUST return, alongside the product data, a per-field
provenance map (`catalog` / `claude_knowledge` / `web_search` / absent) and an
aggregated card-level reliability tag derived from that map.

#### Scenario: Full catalog match

- GIVEN every field's provenance is `catalog`
- WHEN `propose_product` returns
- THEN the card-level tag is "verified" (all catalog-sourced)

#### Scenario: Mixed sources

- GIVEN some fields are `catalog` and others `web_search` or `claude_knowledge`
- WHEN `propose_product` returns
- THEN the card-level tag is "web" (at least one field required external lookup)

#### Scenario: No verified source

- GIVEN no field has provenance `catalog` or `web_search` (only `claude_knowledge` or empty)
- WHEN `propose_product` returns
- THEN the card-level tag is "unverified"

### Requirement: Card-Level Reliability Badge

`ProposeProductCard` MUST render exactly one badge reflecting the card-level
tag: "Catálogo SABBI ✓" (verified), "Búsqueda web ⚠" (web), or "No
verificado" (unverified).

#### Scenario: Badge matches tag

- GIVEN a proposal result with card-level tag "web"
- WHEN the card renders
- THEN it shows the "Búsqueda web ⚠" badge

### Requirement: Field-Level Source Indicators

For each enriched field (commission, currency, administrator, manager,
liquidity, return_rate, geographic_focus, underlying), the card SHOULD show a
small source marker next to the value when the source is not `catalog`.

#### Scenario: Web-sourced field marked

- GIVEN `commission` has provenance `web_search`
- WHEN the card renders the commission field
- THEN a marker (e.g. an icon or label) distinguishes it from catalog-sourced fields

### Requirement: Enriched Field Display

`ProposeProductCard` MUST display the additional catalog-derived fields
(commission, currency, administrator, manager, liquidity, return_rate) when
present, in addition to the existing name/provider/amount/category fields.
(This is new UI surface — the current card only shows name, provider, amount,
category; it does not render catalog enrichment fields at all.)

#### Scenario: Enriched fields visible

- GIVEN a proposed product has commission and liquidity populated
- WHEN the card renders
- THEN both fields are visible with labels, not hidden or dropped

### Requirement: Category/Subcategory Selection with Source and Manual Fallback

The card MUST show category and subcategory with a source indicator when
auto-classified, and MUST prompt the user to select manually when the agent
could not classify the product with confidence.

#### Scenario: Auto-classified with source shown

- GIVEN the agent auto-classified the product into `publicos > US Treasuries`
- WHEN the card renders
- THEN category and subcategory are shown, pre-selected, with an indicator that classification was automatic

#### Scenario: Manual classification required

- GIVEN the agent left category/subcategory empty due to low confidence
- WHEN the card renders
- THEN category and subcategory selectors are shown empty and editable
- AND the user must pick both before confirming the product

## Acceptance Criteria

- [ ] `propose_product` result includes a provenance map and card-level tag
- [ ] Card renders one of the three defined badges based on the tag
- [ ] Field-level markers appear for non-catalog-sourced fields
- [ ] Commission, currency, administrator, manager, liquidity, return_rate are visible on the card when present
- [ ] Category/subcategory show source when auto-classified and are editable/required when empty
