# Delta for portfolio-builder/agent

## MODIFIED Requirements

### Requirement: Tool Parameter Naming for Asset Classification

Tools `add_product` and `update_product` MUST accept a required `asset_class` parameter (enum: `inversiones_directas`, `mercados_privados`, `club_deals`, `mercados_publicos`, `cash_y_equivalentes`, `otros`) instead of `category`. The helper `_normalize_category_key` MUST be renamed `_normalize_asset_class_key` and MUST normalize `asset_class` values only. `subcategory` handling is unaffected.
(Previously: parameter and helper were named `category` / `_normalize_category_key`.)

#### Scenario: Agent adds a product with asset_class

- GIVEN Claude identifies a product to add
- WHEN it calls `add_product` with `asset_class="mercados_privados"`
- THEN the product is persisted to PostgreSQL with `asset_class` set and no `category` field written

#### Scenario: Missing asset_class rejected

- GIVEN the agent attempts `add_product` without `asset_class`
- WHEN the tool validates parameters
- THEN the call MUST fail validation before any DB write

### Requirement: Portfolio Summary Reflects Asset Class Grouping

`get_portfolio_summary` MUST return `asset_classes_used` and a `distribution` map keyed by `asset_class`.
(Previously: keys were `categories_used` and a category-keyed `distribution`.)

#### Scenario: Summary groups by asset class

- GIVEN a portfolio with products across 4 asset classes
- WHEN Claude invokes `get_portfolio_summary`
- THEN the response includes `asset_classes_used` listing those 4 values, with `distribution` percentages keyed by `asset_class`

### Requirement: System Prompt Taxonomy References

The system prompt MUST reference "clase de activo" (asset class) when instructing classification into the 6 taxonomy values; `subcategory` guidance is unchanged.
(Previously: prompt referred to "categoría".)

#### Scenario: Prompt instructs asset_class classification

- GIVEN the agent initializes
- THEN the system prompt's classification section names the 6 valid `asset_class` values and does not reference "categoría"
