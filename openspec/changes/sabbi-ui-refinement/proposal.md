# Proposal: SABBI UI Refinement

## Intent

Align the SABBI frontend with the reference HTML design (`portfolio-builder-v2.html`). The current implementation uses cool gray neutrals, system fonts, no chat tool-result rendering, and generic assistant-ui styling. The reference defines a warm, polished visual language with DM Sans display type, warm neutrals, asymmetric chat bubbles, and inline tool result cards. This is a visual-fidelity + UX pass with one functional addition: inline tool results in chat.

## Scope

### In Scope
- **Typography**: Wire Inter (body) + DM Sans (display/metrics) via `next/font/google`
- **Warm color palette**: Replace cool gray CSS variables with warm neutrals (`#f6f5f2`, `#fafaf8`, `#e2e1dc`); update category colors to match reference (directas `#c2410c`, club `#0d9488`, publicos `#2563eb`, otros `#d97706`, cash `#16a34a`)
- **Chat header**: Gradient avatar circle + green status dot ("En linea")
- **Chat messages**: Asymmetric user bubble radius (`18px 18px 4px 18px`), remove assistant bubble background, translucent attachment chips
- **Inline tool results**: Render `add_product`/`update_product`/`delete_product` tool calls as category-badge + product-name + amount cards inside assistant messages via assistant-ui's tool UI API
- **Summary table polish**: Show placeholder "Retorno"/"Deseado" column values, progress bars on sub-rows
- **Composer**: Rounded pill shape, clip + send only (remove quick-action row)
- **Topbar**: Gradient logo mark + "Portfolio builder" text

### Out of Scope
- Backend/API/DB schema changes
- Computed Retorno/Deseado values (placeholder only)
- Mobile/responsive layout
- New features beyond inline tool results
- Dark mode adjustments

## Capabilities

### New Capabilities
- `chat-tool-results`: Inline rendering of portfolio-mutating tool calls inside chat messages using assistant-ui's `makeAssistantToolUI`

### Modified Capabilities
- None at spec level (visual-only changes to existing components)

## Approach

1. Update `globals.css` variables (neutrals + category palette)
2. Wire Inter + DM Sans in `layout.tsx` via `next/font/google`
3. Restyle `ChatPanel`, `Thread` (messages, composer), `Topbar`
4. Create tool-result UI components using `makeAssistantToolUI` for `add_product`, `update_product`, `delete_product`
5. Polish `SummaryTable` with placeholder values + progress bars
6. Update `ProductCard`/`CategorySection` for DM Sans on amounts

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/web/app/globals.css` | Modified | Warm neutrals + category color variables |
| `apps/web/app/layout.tsx` | Modified | Wire Inter + DM Sans fonts |
| `apps/web/components/chat/ChatPanel.tsx` | Modified | Gradient avatar + status dot |
| `apps/web/components/assistant-ui/thread.tsx` | Modified | Message styling + composer + tool UI registration |
| `apps/web/components/layout/Topbar.tsx` | Modified | Gradient logo mark + label |
| `apps/web/components/portfolio/SummaryTable.tsx` | Modified | Placeholder Retorno/Deseado + progress bars |
| `apps/web/components/portfolio/ProductCard.tsx` | Modified | DM Sans on amounts |
| `apps/web/lib/categories.ts` | Modified | Category color values |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tool UI API mismatch with LangGraph message format | Med | Verify tool_call names match backend `@tool` names; test with live agent |
| Warm palette contrast issues | Low | Check WCAG AA on text/background combos before finalizing |

## Rollback Plan

All changes are frontend-only CSS/component edits. Revert the commit or cherry-pick out individual file changes.

## Dependencies

- `next/font/google` (built into Next.js, no new dependency)
- assistant-ui `makeAssistantToolUI` API (already in `@assistant-ui/react`)

## Success Criteria

- [ ] Inter + DM Sans render correctly; DM Sans on metric values and amounts
- [ ] Page background, panel, borders, and shadows match reference warm palette
- [ ] Chat header shows gradient avatar + green status dot
- [ ] User bubble has asymmetric radius; assistant messages have no bubble background
- [ ] Tool calls from agent render inline in chat with category badge, product name, amount
- [ ] Summary table shows "Retorno" and "Deseado" columns with placeholder values
- [ ] Composer is pill-shaped with clip + send buttons only
- [ ] Topbar shows gradient logo mark + "Portfolio builder"

## Proposal question round

The following assumptions were made based on the provided scope decisions. Review and correct as needed before spec/design phases proceed:

1. **Tool result rendering granularity**: Should each portfolio tool call (`add_product`, `update_product`, `delete_product`) render its own inline card, or should they be grouped per assistant turn into a single card listing all products affected? (Assumption: per-tool-call, matching the reference where each tool result appears as a list.)
2. **Quick-action buttons removal**: The reference composer shows only clip + send. The current implementation has "Captura", "PDF", "Factsheet", "Link" quick-action buttons below the composer. Should these be removed entirely? (Assumption: yes, remove them to match the reference.)
3. **Category color change impact**: Changing category colors (e.g., directas from blue to orange) affects every product card, category tab, section header, donut chart, and summary table. This is intentional and matches the reference. Confirm no existing reports/exports depend on the current color assignments. (Assumption: no external dependencies on specific color hex values.)
4. **Topbar brand text**: Reference says "Portfolio builder" while the current says "SABBI". Should the topbar label change to "Portfolio builder" or stay as "SABBI"? (Assumption: change to "Portfolio builder" per reference.)
