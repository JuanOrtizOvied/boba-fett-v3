# Cascading Search Specification

## Purpose

New capability `multi-level-search`: replaces the single-path `search_catalog`
tool with a three-level cascading search (`search_product`) that queries the
SABBI catalog, then Claude's own knowledge, then Tavily web search — in that
order — and returns a unified result with per-field provenance so downstream
consumers (proposal card, system prompt rules) know which data is verified.

## Requirements

### Requirement: Cascade Order

The system MUST query levels in strict order — L1 catalog, then L2 Claude
knowledge, then L3 Tavily web search — and MUST stop as soon as all searched
fields are populated with non-empty values.

#### Scenario: L1 catalog match is complete

- GIVEN a query matches a `product_catalog` row with all fields populated
- WHEN `search_product` runs
- THEN only L1 executes; L2 and L3 are skipped
- AND every field's provenance is `catalog`

### Requirement: L1 Catalog Search (Authoritative)

L1 MUST reuse the existing `pg_trgm` similarity search (name, underlying,
administrator) and MUST remain the authoritative source: any field present in
a catalog row MUST NOT be overwritten by L2 or L3.

#### Scenario: Catalog field is never overwritten

- GIVEN L1 returns a match with `commission` populated but `liquidity` empty
- WHEN L2/L3 also return a value for `commission`
- THEN the final result keeps the L1 `commission` value with provenance `catalog`
- AND only `liquidity` is eligible for completion from L2/L3

### Requirement: L2 Claude Knowledge Extraction

The system MUST use a separate, non-streaming Claude completion with a
structured extraction prompt to fill still-empty fields from the model's own
training knowledge. It MUST NOT invent values for fields it is not confident
about — those fields MUST remain empty.

#### Scenario: L2 fills missing fields after no catalog match

- GIVEN L1 returns no match for "Vanguard Total World Stock ETF"
- WHEN L2 runs
- THEN known fields (asset_class, geographic_focus, currency) are filled with provenance `claude_knowledge`
- AND any field Claude is unsure about remains empty

### Requirement: L3 Tavily Web Search

The system MUST use the `tavily-python` SDK, authenticated via
`TAVILY_API_KEY`, as the last-resort source for fields still empty after L1+L2.

#### Scenario: L3 completes remaining fields

- GIVEN L1 and L2 leave `commission` and `manager` empty
- WHEN L3 runs and finds real published data
- THEN those fields are filled with provenance `web_search`
- AND no fabricated values are returned if Tavily finds nothing

### Requirement: Graceful Degradation Without Tavily

When `TAVILY_API_KEY` is not set, the system MUST skip L3 entirely and MUST
inform the user that only catalog and knowledge-based data were checked.

#### Scenario: Missing API key

- GIVEN `TAVILY_API_KEY` is unset
- WHEN L1 and L2 leave fields empty
- THEN L3 is skipped without error
- AND the agent tells the user which fields could not be verified

### Requirement: Never-Invent-Data Guardrail

At every level, the system MUST leave a field empty rather than fabricate a
value it cannot verify.

#### Scenario: No data found anywhere

- GIVEN none of L1/L2/L3 produce a value for `return_rate`
- WHEN the search completes
- THEN `return_rate` is empty with no provenance entry
- AND the agent informs the user the field is unknown

### Requirement: Search Field Parity

All three levels MUST search/return the same field set: name, asset_class,
geographic_focus, underlying, commission, currency, administrator, manager,
liquidity, return_rate, category, subcategory.

#### Scenario: Consistent field shape across levels

- GIVEN a search completes at any cascade depth
- WHEN the result is returned
- THEN it contains all 12 fields (empty string where unknown) plus a `provenance` map keyed by field name

### Requirement: Auto-Classification

The system MUST assign `category` and `subcategory` from the taxonomy when
confident, and MUST leave both empty (informing the user) when not confident.

#### Scenario: Confident classification

- GIVEN extracted data clearly matches "Renta Fija > US Treasuries"
- WHEN classification runs
- THEN category="publicos" and subcategory="US Treasuries" are set automatically

#### Scenario: Ambiguous classification

- GIVEN extracted data does not clearly map to any taxonomy leaf
- WHEN classification runs
- THEN category and subcategory remain empty
- AND the agent asks the user to classify manually

## Acceptance Criteria

- [ ] L1 catalog search accuracy matches or exceeds current `search_catalog`
- [ ] L2 fills fields only from real model knowledge, never fabricated
- [ ] L3 only runs when L1+L2 leave fields empty and `TAVILY_API_KEY` is set
- [ ] Every returned field carries a provenance value or is empty
- [ ] Graceful degradation verified when `TAVILY_API_KEY` is absent
- [ ] Auto-classification leaves taxonomy fields empty on low confidence
