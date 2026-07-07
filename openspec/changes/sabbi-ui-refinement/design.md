# Design: SABBI UI Refinement

## Technical Approach

Visual-fidelity pass aligning the Next.js frontend with the reference HTML design. All changes are frontend-only: CSS variable updates, font wiring, component class modifications, and one new functional addition (inline tool result cards in chat). Existing component structure and data flow are preserved; no new state management or API calls.

## Architecture Decisions

### Decision: Tool UI Registration

| Option | Tradeoff | Chosen |
|--------|----------|--------|
| `MessagePrimitive.Content` `components.tools.by_name` prop | Current recommended API, no deprecation, scoped to `AssistantMessage` | **Yes** |
| `makeAssistantToolUI` (global registration) | Deprecated in 0.14.x, global side-effect component | No |
| `Unstable_PartsGrouped` with custom grouping | Unstable API, more complex, overkill for visual grouping | No |

**Rationale**: The project already defines custom `AssistantMessage` in `thread.tsx` using `MessagePrimitive.Content`. Adding `components={{ tools: { by_name: { add_product: ToolResultItem, update_product: ToolResultItem, delete_product: ToolResultItem }, Fallback: () => null } }}` is a one-line prop addition. Each tool receives `{ toolName, args, result, status }` and renders a compact row.

### Decision: Tool Result Grouping (per-turn card)

| Option | Tradeoff | Chosen |
|--------|----------|--------|
| CSS adjacency selectors on tool-result containers | Zero JS overhead, tool-call parts already render as adjacent siblings | **Yes** |
| React-level wrapper via `Unstable_PartsGrouped` | Unstable API, more complex component tree | No |

**Rationale**: assistant-ui renders message parts sequentially in the DOM. Consecutive `tool-call` parts produce adjacent `.aui-tool-result-item` elements. CSS handles visual grouping: shared border card on first/last items, dividers between items. The reference HTML uses this exact pattern (`.aui-tool-item:not(:last-child){border-bottom}`).

### Decision: Font Variable Strategy

| Option | Tradeoff | Chosen |
|--------|----------|--------|
| `next/font/google` CSS variables in `layout.tsx` + `@theme inline` | Standard Next.js optimization, font-display swap, zero layout shift | **Yes** |
| Direct Google Fonts `<link>` tag | No font optimization, FOUT risk | No |

**Rationale**: `next/font/google` generates `--font-inter` and `--font-dm-sans` CSS variables on `<html>`. `globals.css` `@theme inline` maps them to `--font-sans` (Inter) and `--font-display` (DM Sans). Tailwind classes `font-sans` and `font-display` then work everywhere.

### Decision: Color Migration

| Option | Tradeoff | Chosen |
|--------|----------|--------|
| Update CSS variable values in-place, add sub-color vars | All component references preserved via `categoryColorVar()` | **Yes** |
| Rename variables to match reference naming | Breaks every component using current names | No |

**Rationale**: All components reference `var(--sabbi-cat-*)` via `categoryColorVar()` in `lib/categories.ts`. Changing values (e.g., directas from `#3b82f6` to `#c2410c`) preserves all references. New sub-color variables (`--sabbi-cat-directas-bg`, `--sabbi-cat-directas-text`) are added for badge backgrounds and category tab active states.

### Decision: Chat Styling

| Option | Tradeoff | Chosen |
|--------|----------|--------|
| Modify Tailwind classes in custom components directly | Clean, components already customized | **Yes** |
| CSS-only overrides on assistant-ui class names | Fragile, breaks on assistant-ui updates | No |

**Rationale**: `UserMessage` and `AssistantMessage` in `thread.tsx` are already custom components with full control over classes. Changing bubble radius and removing assistant background is a class edit, not a structural change.

## Data Flow

No new data flow. Tool result rendering reads from the existing `MessagePrimitive.Content` part pipeline:

    LangGraph agent → tool_call parts in message → assistant-ui Content renderer
         │                                                    │
         │                                              tools.by_name lookup
         │                                                    │
         └── args: {name, amount, category} ──→ ToolResultItem component

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/web/app/globals.css` | Modify | Warm neutral palette (`#f6f5f2`, `#fafaf8`, `#e2e1dc`), category color value updates, sub-color vars (bg/text per category), font-display theme var, tool-result CSS adjacency styles |
| `apps/web/app/layout.tsx` | Modify | Wire Inter + DM Sans via `next/font/google`, apply CSS variable classes to `<html>` |
| `apps/web/components/assistant-ui/thread.tsx` | Modify | `AssistantMessage`: remove bg, add `components.tools.by_name` prop. `UserMessage`: asymmetric radius (`rounded-[18px] rounded-br-[4px]`). `Composer`: pill shape. Add `ToolResultItem` component. Keep quick-action buttons. |
| `apps/web/components/chat/ChatPanel.tsx` | Modify | Gradient avatar circle (`bg-gradient-to-br from-violet-600 to-indigo-700`), green status dot + "En linea" |
| `apps/web/components/layout/Topbar.tsx` | Modify | Gradient logo mark div with "S", brand text "SABBI Portfolio Builder" |
| `apps/web/components/portfolio/ProductCard.tsx` | Modify | `font-display` class on amount element |
| `apps/web/components/portfolio/MetricsRow.tsx` | Modify | `font-display` class on metric values |
| `apps/web/components/portfolio/SummaryTable.tsx` | Modify | Placeholder Retorno/Deseado values (e.g., "8.0%"), progress bars on sub-rows using category color |
| `apps/web/components/portfolio/PortfolioSummary.tsx` | Modify | `font-display` on donut center text |
| `apps/web/lib/categories.ts` | Modify | Add `bgCssVar` and `textCssVar` fields to `CategoryMeta`, add `categoryBgVar()` / `categoryTextVar()` helpers |

## Interfaces / Contracts

```tsx
// ToolResultItem component props (from assistant-ui ToolCallMessagePartProps)
interface ToolResultItemProps {
  toolName: string;              // "add_product" | "update_product" | "delete_product"
  args: Record<string, unknown>; // { name, amount, category, ... }
  result: unknown;               // { status, product: {...} } | { status, product_id }
  status: { type: string };      // "complete" | "in-progress" | "error"
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Visual | Color palette, font rendering, chat bubbles, tool cards | Manual visual comparison against reference HTML |
| Functional | Tool result cards render for add/update/delete tool calls | Trigger agent tool calls via chat, verify inline rendering |
| Regression | Existing CRUD flows (edit modal, delete confirmation, category tabs) | Manual smoke test: add, edit, delete product; switch views |

## Migration / Rollout

No migration required. All changes are CSS variable value updates and component class modifications. Single commit, single deploy. Revert = `git revert`.

## Open Questions

- [ ] Verify `get_portfolio_summary` tool calls should render hidden (`Fallback: () => null`) or show a summary card — current design hides them since they have no visual equivalent in reference
