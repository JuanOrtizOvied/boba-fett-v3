# Delta for portfolio-builder/agent — Category Taxonomy

## MODIFIED Requirements

### Requirement: Category Taxonomy

The system MUST classify every portfolio product into one of 6 top-level
categories, each with a 3-level hierarchy (category -> subcategory group ->
leaf). The taxonomy MUST fully replace the previous flat 2-level dict (no
migration needed — no production data exists).
(Previously: 6 categories with a single flat `subcategories` list per
category, e.g. `directas` had `["Accionariado", "RE Perú - Residencial", ...]`
with no grouping level.)

| # | Category (key) | Subcategory groups -> leaves |
|---|---|---|
| 1 | Real Estate Directo (`directas`) | RE Perú (Residencial, Oficinas, Comercial/Industrial); RE Extranjero |
| 2 | Mercados Privados (`privados`) | Deuda Privada; Private Equity; Venture Capital; Real Estate; Hedge Funds; Infraestructura |
| 3 | Club Deals (`club`) | Real Estate (Perú, Extranjero); Deuda Privada (Perú, Extranjero); Otros (Perú, Extranjero) |
| 4 | Mercados Públicos (`publicos`) | Renta Variable (US Large Cap, US Mid & Small Cap, Developed ex-US, EM ex-Perú, Perú); Renta Fija (US Treasuries, IG Corporates AAA-BBB, High Yield BB-, EM Bonds, LatAm Bonds, Perú Bonds) |
| 5 | Otros (`otros`) | Cripto (Bitcoin, Ethereum, Otras); Commodities (Oro) |
| 6 | Cash y Equivalentes (`cash`) | Cash (Depósitos a plazo, Fondos de Money Market) |

#### Scenario: Taxonomy exposes 3 levels

- GIVEN the taxonomy structure is loaded
- WHEN a category is inspected (e.g. `publicos`)
- THEN it exposes subcategory groups (e.g. "Renta Fija")
- AND each group exposes leaf values (e.g. "US Treasuries")

#### Scenario: All 6 categories present with full leaf sets

- GIVEN the taxonomy is validated
- WHEN all categories are enumerated
- THEN exactly 6 top-level categories exist, matching the table above, each with at least one subcategory group and leaf

#### Scenario: Classification references category + subcategory leaf

- GIVEN a product is auto-classified
- WHEN the result is stored
- THEN it stores the top-level category key AND the specific leaf subcategory (not just the group)

### Requirement: System Prompt Reflects Taxonomy and Cascade Rules

The system prompt MUST enumerate the new taxonomy, describe the L1→L2→L3
cascade order, state provenance display rules, and include the
never-invent-data guardrail.
(Previously: system prompt referenced the old flat 6-category list and a
single-path `search_catalog` instruction with no cascade or provenance rules.)

#### Scenario: Prompt lists new categories

- GIVEN the agent initializes
- THEN the system prompt's category section matches the 3-level taxonomy table

#### Scenario: Prompt includes cascade and guardrail instructions

- GIVEN the agent initializes
- THEN the system prompt instructs: search catalog first, then knowledge, then web search
- AND the prompt states fields must be left empty rather than invented
- AND the prompt states the agent must ask the user to classify manually when auto-classification is not confident

## Acceptance Criteria

- [ ] `CATEGORIES` (or its replacement structure) exposes 6 categories x subcategory groups x leaves
- [ ] All leaves from the specification table are present
- [ ] System prompt renders the new taxonomy and cascade/provenance rules
- [ ] No references to the old flat taxonomy remain in the prompt or code comments
