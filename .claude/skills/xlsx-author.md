---
name: xlsx-author
description: Institutional-grade Excel workbook conventions for SABBI portfolio exports — color coding, formula-only calc sheets, validation checks, and named ranges.
triggers:
  - excel export
  - xlsx
  - workbook
  - spreadsheet
  - openpyxl
  - export excel
  - portfolio export
---

# xlsx-author — SABBI Excel Conventions

Apply institutional-grade conventions when building or modifying Excel exports in `apps/backend/src/db/excel.py`. SABBI uses `openpyxl` to generate `.xlsx` workbooks server-side, streamed to the client via FastAPI.

## Color Conventions

Use font color to distinguish cell types at a glance:

| Cell Type | Font Color | Hex | When |
|-----------|-----------|-----|------|
| Hardcoded input | Blue | `0000FF` | Values entered directly (amounts, rates, manual overrides) |
| Formula | Black | `000000` | Any cell that computes from other cells (totals, percentages, deltas) |
| Cross-sheet reference | Green | `008000` | Formulas referencing another sheet (e.g. summary pulling from asset class sheets) |

Apply via `openpyxl.styles.Font(color="XXXXXX")`.

### Existing SABBI Styles to Preserve

The current export (`db/excel.py`) uses:
- `HEADER_FILL`: indigo background (`4F46E5`) with white bold text — keep this
- `CURRENCY_FORMAT`: `'"$"#,##0'` — keep this
- `PERCENT_FORMAT`: `'0.0%'` — keep this

Add the blue/black/green font convention to data cells without breaking existing header styling.

## Structural Rules

### Inputs Separation
When the workbook includes editable assumptions or parameters (target allocations, rebalancing bands, commission rates):
- Place all input values on a dedicated **Inputs** sheet
- Calculation sheets reference Inputs via cross-sheet formulas (green font)
- Never hardcode assumptions in calculation cells

### Named Ranges
Create named ranges for values referenced from multiple sheets or likely to be cited in reports:
- `total_portfolio_value`
- `total_products_count`
- Per-asset-class totals (e.g. `total_mercados_privados`)

### Checks Sheet
When the workbook contains formulas, add a **Checks** sheet that validates internal consistency:

| Check | Formula | Result |
|-------|---------|--------|
| Asset class totals = Portfolio total | `=SUM(class_totals) = total` | TRUE/FALSE |
| All percentages sum to 100% | `=SUM(pct_column) = 1` | TRUE/FALSE |
| Product count matches | `=COUNTA(products) = summary_count` | TRUE/FALSE |

Use conditional formatting: green fill for TRUE, red fill for FALSE.

## SABBI-Specific Structure

The current workbook layout (`build_portfolio_workbook`):

1. **Portafolio Final** (index 0) — summary by asset class with amounts, percentages, product counts
2. **One sheet per asset class** — products with name, provider, proportional amount, underlying

When extending this structure:

- Preserve the `ASSET_CLASS_ORDER` from `excel.py` for sheet ordering
- Use `ASSET_CLASS_LABELS` for sheet titles (truncated to 31 chars for Excel compatibility)
- Products split across asset classes show proportional amounts, not full amounts
- Total rows use bold font, matching the existing convention

## When Adding New Sheets

- Rebalancing analysis → add a "Drift Analysis" sheet after asset class sheets
- Target vs actual → add columns to "Portafolio Final" rather than a separate sheet
- Historical snapshots → separate workbook, not appended to the portfolio export

## One Model Per File

Each workbook represents one portfolio view. Do not append unrelated analysis to an existing export. If the user needs both a portfolio export and a rebalancing report, generate two files.
