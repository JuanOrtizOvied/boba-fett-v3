# Visual System Specification

## Purpose

Defines the shared typography, color palette, and design tokens applied across the SABBI portfolio builder UI. This is a new cross-cutting capability underpinning `chat-refinement` and `dashboard-refinement`.

## Requirements

### Requirement: Font loading via next/font/google

The application MUST load Inter (body) and DM Sans (display/metrics) through `next/font/google` in `apps/web/app/layout.tsx`, with no external `<link>` tags.

#### Scenario: Fonts render correctly

- GIVEN the app boots in development or production
- WHEN any page renders
- THEN body text uses the Inter font family
- AND display/metric elements (amounts, section titles, portfolio totals) use the DM Sans font family
- AND no network request is made to `fonts.googleapis.com` at runtime (self-hosted via `next/font`)

### Requirement: Warm neutral color tokens

The system MUST replace the current cool-gray CSS variables with warm neutrals matching the reference design.

#### Scenario: Warm palette applied

- GIVEN `globals.css` defines root CSS variables
- WHEN the page renders
- THEN `--bg-page` is `#f6f5f2`, `--bg-panel` is `#fafaf8`, `--border` is `#e2e1dc`
- AND text/background combinations meet WCAG AA contrast

### Requirement: Category color tokens

Each of the 6 portfolio categories MUST have a dedicated color variable (accent, background, text) matching the reference values.

#### Scenario: Category colors match reference

- GIVEN the 6 categories (directas, privados, club, publicos, otros, cash)
- WHEN their colors are read from CSS variables
- THEN values are: directas `#c2410c`, privados `#7c3aed`, club `#0d9488`, publicos `#2563eb`, otros `#d97706`, cash `#16a34a`
- AND every component referencing category color (badges, tabs, cards, section headers, donut chart, summary table) reads from these shared tokens — no hardcoded hex values in component files

#### Scenario: Category color change propagates consistently

- GIVEN a category color token changes in `apps/web/lib/categories.ts` or `globals.css`
- WHEN the app rebuilds
- THEN every consumer (ProductCard border, CategorySection badge, cat-tab active state, donut segment, summary table row) reflects the new color without additional per-component edits

### Requirement: Design token surface (radius, shadow, transition)

The system MUST define shared tokens for border radius, card shadow, and transition timing, matching the reference values.

#### Scenario: Tokens applied to cards and buttons

- GIVEN a product card or button renders
- WHEN inspected
- THEN border-radius uses `--radius` (10px) or `--radius-lg` (14px)
- AND card shadow uses `--shadow-card` (`0 1px 3px rgba(0,0,0,.04), 0 0 0 .5px rgba(0,0,0,.06)`)
- AND hover shadow uses `--shadow-hover`
- AND interactive transitions use `.2s cubic-bezier(.4,0,.2,1)`
