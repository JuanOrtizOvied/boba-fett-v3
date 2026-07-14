# Frontend Component Testing Specification

## Purpose

Vitest + React Testing Library infrastructure and component tests for
`ProposeProductCard` and `BulkAcceptBar`, the two chat-embedded components
that drive portfolio product confirmation. No test infrastructure currently
exists on the frontend.

## Requirements

### Requirement: Test Infrastructure Bootstrap

The frontend MUST have a working `vitest` + `@testing-library/react` +
`jsdom` setup runnable via `vitest run`, with `useThreadRuntime` mockable at
the module level.

#### Scenario: Vitest runs against a jsdom environment

- GIVEN `vitest.config.ts` configures `environment: "jsdom"`
- WHEN `vitest run` is executed
- THEN component tests render without a `document is not defined` error

### Requirement: ProposeProductCard Rendering

`ProposeProductCard` MUST render the proposed product's fields when given a
`status: "proposed"` tool result, and MUST render nothing when the tool
result lacks a proposed product.

#### Scenario: Renders with valid, fully-populated product

- GIVEN a tool result with `status: "proposed"` and a product with name, amount, category, and subcategory set
- WHEN the card renders
- THEN the name, formatted amount, category, and subcategory are visible and no missing-fields warning is shown

#### Scenario: Renders with incomplete data and shows validation warning

- GIVEN a proposed product missing `subcategory`
- WHEN the card renders
- THEN a "Completa: subcategoría" warning is shown and the "Sí, agregar" button is disabled

#### Scenario: Renders nothing for non-proposed result

- GIVEN a tool result with `status: "error"`
- WHEN the card renders
- THEN the component returns null (no DOM output)

### Requirement: ProposeProductCard Field Editing

While `responded` is `null`, the card MUST render editable inputs for name,
provider, amount, category, and subcategory, updating local validation
state on change.

#### Scenario: Editing amount to a valid positive number clears the warning

- GIVEN a card with `amount` initially invalid (0)
- WHEN the user types a positive number into the amount input
- THEN the missing-fields warning clears and "Sí, agregar" becomes enabled

### Requirement: ProposeProductCard Confirm and Reject Actions

Confirming a valid card MUST call `runtime.append` with a user message
containing the exact field values in the documented text format; confirming
an invalid card MUST be a no-op; rejecting MUST always call
`runtime.append` with a rejection message.

#### Scenario: Confirm sends exact message text

- GIVEN a valid card with name "BlackRock Fund", amount 1000, category "publicos", subcategory "Renta Fija"
- WHEN the user clicks "Sí, agregar"
- THEN `runtime.append` is called once with text `Sí, agregar al portafolio con: nombre: BlackRock Fund, monto: 1000, categoría: publicos, subcategoría: Renta Fija.`
- AND the card switches to the "✓ Confirmado" state

#### Scenario: Confirm is blocked when invalid

- GIVEN a card with an empty name
- WHEN the user clicks "Sí, agregar" (or it is triggered programmatically)
- THEN `runtime.append` is NOT called and `responded` remains `null`

#### Scenario: Reject sends rejection message regardless of validity

- GIVEN a card with an incomplete product
- WHEN the user clicks "No"
- THEN `runtime.append` is called with text `No, no agregar "{name}".` and the card switches to "✗ Descartado"

### Requirement: ProposalBatchProvider Registration

A `ProposeProductCard` rendered inside `ProposalBatchProvider` MUST
register/update its entry (validity, values, `responded`) on the batch
context on mount and on relevant field changes, and MUST unregister on
unmount.

#### Scenario: Card registers on mount

- GIVEN a `ProposalBatchProvider` wrapping a single valid card
- WHEN the card mounts
- THEN `batch.entries` contains one entry with `isValid: true` and `responded: null`

#### Scenario: Card unregisters on unmount

- GIVEN a registered card
- WHEN the card unmounts
- THEN its entry is removed from `batch.entries`

### Requirement: BulkAcceptBar Visibility Gating

`BulkAcceptBar` MUST render nothing when fewer than 2 proposal entries
exist or when all entries are already responded, and MUST render when 2+
entries are pending.

#### Scenario: Hidden with a single pending card

- GIVEN only one registered pending entry
- WHEN `BulkAcceptBar` renders
- THEN it renders null

#### Scenario: Visible with 2+ pending cards, some invalid

- GIVEN two pending entries, one valid and one missing `subcategory`
- WHEN `BulkAcceptBar` renders
- THEN it shows "1 de 2 productos listos", lists the incomplete entry's missing fields, and disables "Agregar todos"

#### Scenario: Hidden after all cards are responded

- GIVEN two entries that have both been confirmed or rejected
- WHEN `BulkAcceptBar` renders
- THEN it renders null

### Requirement: BulkAcceptBar Combined Confirmation Message

When all pending entries are valid, clicking "Agregar todos" MUST call
`runtime.append` once with a single message combining every pending
entry's field text, and mark each entry `responded: "yes"`.

#### Scenario: Agregar todos sends combined message for all-valid batch

- GIVEN two valid pending entries: "Fund A" (amount 500) and "Fund B" (amount 800)
- WHEN the user clicks "Agregar todos"
- THEN `runtime.append` is called once with text starting `Sí, agregar todos al portafolio:` followed by one line per entry
- AND both entries become `responded: "yes"`, causing `BulkAcceptBar` to unmount on re-render

## Mocking Boundary

Real: component render tree, `ProposalBatchProvider`/`ProposalBatchContext`,
local component state and validation logic. Mocked: `useThreadRuntime`
(returns an object with an `append` spy) — no real assistant-ui runtime,
network, or LLM involved.
