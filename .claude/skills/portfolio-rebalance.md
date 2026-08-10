---
name: portfolio-rebalance
description: Analyzes portfolio allocation drift against target IPS weights and generates rebalancing recommendations using SABBI's asset class taxonomy and portfolio tools.
triggers:
  - rebalance
  - portfolio drift
  - allocation check
  - rebalancing
  - my portfolio is out of balance
  - asset allocation
  - drift analysis
---

# Portfolio Rebalance — SABBI

Analyze allocation drift and generate rebalancing recommendations for a SABBI portfolio. All data comes from PostgreSQL via `get_portfolio_summary` and product-level tools.

## Step 1 — Current State

Call `get_portfolio_summary` to retrieve the investor's holdings grouped by asset class. The response includes per-asset-class totals and overall portfolio value.

SABBI asset classes (canonical keys from `agent/state.py`):

| Key | Label |
|-----|-------|
| `inversiones_directas` | Inversiones directas |
| `mercados_privados` | Mercados privados |
| `club_deals` | Club deals |
| `mercados_publicos` | Mercados públicos |
| `otros` | Otros |
| `cash_y_equivalentes` | Cash y equivalentes |

Products can split across multiple asset classes via weighted `asset_class` allocations (e.g. 60% mercados_privados / 40% club_deals). Use proportional amounts, not the full product amount.

## Step 2 — Target Allocation

Ask the investor for their target allocation (IPS) if not already known. Present it as a table:

| Asset Class | Current % | Target % | Drift |
|-------------|-----------|----------|-------|
| ... | ... | ... | ±X% |

Flag any position where drift exceeds the rebalancing band. Default bands:

- Core asset classes (inversiones_directas, mercados_privados, mercados_publicos): ±5%
- Satellite (club_deals, otros, cash_y_equivalentes): ±3%

## Step 3 — Drift Analysis

For each asset class outside its band:

1. Calculate the dollar amount needed to return to target
2. Identify which products within that asset class are over/underweight
3. Consider subcategory balance (e.g. within mercados_publicos, check Renta Variable vs Renta Fija split)

Drill into the 3-level taxonomy when relevant:
- Asset class → subcategory group → leaf
- Example: `mercados_publicos` → `Renta Variable` → `US Large Cap`

## Step 4 — Rebalancing Recommendations

Generate specific trade recommendations:

### Reduce overweight positions
- Identify products to trim (prefer largest drift first)
- Show: product name, current amount, recommended new amount, dollar change

### Increase underweight positions
- Identify products to add to, or suggest new products via `search_product`
- Show: product name, current amount, recommended new amount, dollar change

### New contributions
- If the investor has cash to deploy, recommend allocation of new money to underweight classes first

Present as a table:

| Action | Product | Current (USD) | Target (USD) | Change (USD) |
|--------|---------|--------------|--------------|-------------|
| Reduce | ... | ... | ... | -X |
| Add | ... | ... | ... | +X |

## Step 5 — Implementation

After the investor approves recommendations:

- Use `update_product` to adjust amounts on existing products
- Use `add_product` (via `propose_product` → confirmation → `add_product`) for new positions
- Use `delete_product` only if a position is fully liquidated

Offer to `create_snapshot` before executing changes so the investor can compare before/after.

## Step 6 — Summary

Show a before/after comparison:

| Asset Class | Before % | After % | Target % |
|-------------|----------|---------|----------|
| ... | ... | ... | ... |

Include:
- Total portfolio value (unchanged if rebalancing, increased if new capital)
- Number of trades executed
- Remaining drift (should be within bands)

## Key Rules

- Never execute trades without explicit investor confirmation
- Always offer a snapshot before making changes
- Use proportional amounts for products split across asset classes
- Suggest `search_product` when adding new positions to get enriched data
- If the investor has no target allocation, suggest a reasonable starting point based on their portfolio composition and ask for confirmation
- Present all amounts in USD with proper formatting
