# Delta for portfolio-builder/dashboard

## MODIFIED Requirements

### Requirement: Asset Class Filter Tabs and Sections

The dashboard MUST render `AssetClassTabs` (renamed from `CategoryTabs`) and `AssetClassSection` (renamed from `CategorySection`). Filtering, grouping, counts, colors, and labels MUST behave identically to the prior implementation, keyed by `asset_class`.
(Previously: `CategoryTabs`/`CategorySection`, keyed by `category`.)

#### Scenario: Filter tabs group by asset class

- GIVEN a portfolio with products in 6 asset classes
- WHEN the investor views the filter tabs
- THEN each tab shows the same label/color/count as before, sourced from `asset_class`

#### Scenario: Selecting a tab filters sections

- GIVEN the investor clicks the "Mercados privados" tab
- WHEN the dashboard re-renders
- THEN only the `AssetClassSection` for that asset class is shown

### Requirement: Distribution Donut and Summary Table Keyed by Asset Class

The donut chart, legend, and consolidated summary table MUST group and label by `asset_class`, with unchanged visual behavior (colors, and percentages summing to 100%).
(Previously: grouped by `category`.)

#### Scenario: Donut chart renders per asset class

- GIVEN portfolio distribution across asset classes
- WHEN the summary view renders the donut chart
- THEN each segment corresponds to an asset class with its existing color and percentage

### Requirement: Excel Export Sheets Keyed by Asset Class

`GET /api/portfolio/:id/export` MUST generate per-asset-class sheets and a "Portafolio Final" sheet using `asset_class` as the header/grouping field. Sheet structure and totals MUST be otherwise unchanged.
(Previously: sheets/headers used `category`.)

#### Scenario: Export uses asset_class headers

- GIVEN a complete portfolio
- WHEN the investor exports to Excel
- THEN each per-asset-class sheet and the consolidated sheet use `asset_class` as the grouping field, and percentages still sum to 100%
