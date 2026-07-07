# Tasks: SABBI UI Refinement

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300-380 |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Foundation → PR2 Chat → PR3 Dashboard → PR4 Integration/QA |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation: fonts + palette + tokens | PR 1 | Base = main; independent, testable via visual check |
| 2 | Chat refinement incl. tool-result cards | PR 2 | Base = main; depends on PR 1 tokens (category vars, font-display) |
| 3 | Dashboard polish | PR 3 | Base = main; depends on PR 1 tokens only |
| 4 | Integration & QA | PR 4 | Base = main; depends on PR 1-3 merged |

## Phase 1: Foundation (fonts, palette, tokens) — spec: visual-system.spec.md

- [x] T-001 Wire Inter + DM Sans via `next/font/google` in `apps/web/app/layout.tsx`; expose `--font-inter`/`--font-dm-sans` on `<html>`. AC: no `fonts.googleapis.com` request at runtime; body renders Inter.
- [x] T-002 Update `apps/web/app/globals.css`: warm neutrals (`--bg-page:#f6f5f2`, `--bg-panel:#fafaf8`, `--border:#e2e1dc`), category values (directas `#c2410c`, privados `#7c3aed`, club `#0d9488`, publicos `#2563eb`, otros `#d97706`, cash `#16a34a`), `--font-display` theme var, `--radius`/`--radius-lg`/`--shadow-card`/`--shadow-hover`/transition tokens. AC: WCAG AA text/bg contrast; no hardcoded hex in components.
- [x] T-003 Add `bgCssVar`/`textCssVar` to `CategoryMeta` + `categoryBgVar()`/`categoryTextVar()` in `apps/web/lib/categories.ts`; add matching vars in `globals.css`. AC: badges/tabs consume new helpers, no per-component edits needed on future color change.

## Phase 2: Chat refinement — spec: chat-refinement.spec.md

- [x] T-004 `ChatPanel.tsx`: gradient avatar circle + green status dot "En línea" next to "Asistente SABBI".
- [x] T-005 `thread.tsx` UserMessage: radius `18px 18px 4px 18px`, accent bg/white text. AssistantMessage: remove bg + radius (transparent, left-aligned).
- [x] T-006 `thread.tsx`: attachment chips `rgba(255,255,255,.12)` bg / `.2` border inside user bubble (image + PDF chips).
- [x] T-007 `thread.tsx` Composer: pill shape (`border-radius:20px`), accent focus ring; **keep** existing quick-action row (Captura/PDF/Factsheet/Link) unchanged per spec.
- [x] T-008 `thread.tsx`: add `ToolResultItem` component + `components.tools.by_name` on `AssistantMessage`'s `MessagePrimitive.Content` for `add_product`/`update_product`/`delete_product` (category badge + name + amount); `Fallback: () => null` for others (e.g. `get_portfolio_summary`). Add CSS adjacency grouping in `globals.css` (shared card border, `:not(:last-child)` divider) so one turn's tool calls render as ONE card. AC: 4x `add_product` in one turn → single card, 4 items, call order preserved.

## Phase 3: Dashboard polish — spec: dashboard-refinement.spec.md

- [ ] T-009 `Topbar.tsx`: 28x28 gradient logo mark (`linear-gradient(135deg,#7c3aed,#4338ca)`) + brand text exactly "SABBI Portfolio Builder".
- [ ] T-010 `SummaryTable.tsx`: verify placeholder "—" Retorno/Deseado + progress bars render correctly against new palette (logic already present; adjust only styling/contrast if needed).
- [ ] T-011 `font-display` class on `ProductCard.tsx` amount, `MetricsRow.tsx` values, `PortfolioSummary.tsx` donut center text.

## Phase 4: Integration & QA

- [ ] T-012 Manual visual diff against `/Users/juan/Downloads/portfolio-builder-v2.html`: palette, fonts, chat bubbles, tool cards, composer, topbar.
- [ ] T-013 Smoke test regressions: add/edit/delete product, category tabs, builder/resumen view switch, live-agent multi-product turn (chat-refinement scenarios).
- [ ] T-014 WCAG AA contrast check on warm neutrals + all 6 category text/bg combos.

## Dependencies

Phase 1 blocks Phase 2 and 3 (tokens/fonts consumed everywhere). Phase 2 and 3 are mutually independent (parallelizable). Phase 4 depends on all prior phases merged.
