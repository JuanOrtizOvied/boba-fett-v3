# Feature: restore the web test suite to green (stale fixes)

- **Feature ID:** `web-tests-green`
- **File locator:** `odd/tasks/web-tests-green.md`
- **Branch:** `feat/ficha-catalog-curation`.
- **Run:** `yarn workspace web test` (vitest), `tsc --noEmit`, `eslint`.

## Objective

Six pre-existing web test failures (3 files) predated UI changes and were carried
as "0 new" noise on every run. Make the web suite green so both stacks have a
trustworthy signal. These are stale-test fixes, not product changes.

## Tasks
- [x] **T-1 — bulk-accept-bar (4).** DONE. Route: INLINE. `ProposeProductCard`
  now calls `useAuiState((s) => s.thread.messages)`, which the test's
  `@assistant-ui/react` mock did not provide (`No "useAuiState" export...`).
  Added `useAuiState: vi.fn((selector) => selector({ thread: { messages: [] },
  message: { id, createdAt: null } }))` to the mock. 4/4.
- [x] **T-2 — propose-product-card (1).** DONE. Route: INLINE. `getByText(/composición/)`
  matched two nodes (the `Completa:` warning and the "...definir la composición"
  hint). Scoped to the warning: `getByText(/Completa:.*composición/)`. 14/14.
- [x] **T-3 — admin-portfolio-approval (1).** DONE. Route: INLINE. The modal's
  catalog comparison no longer says "valores actuales"; with `catalogEntry` it
  shows "Este producto ya existe en el catálogo" + per-row "Valor actual" labels,
  and proposed values live in editable inputs. Updated the assertions: header
  regex, `getAllByText("Valor actual")`, catalog commission "1.5%" as text, and
  the proposed "2.0%" via `getByDisplayValue`. 9/9.
- [x] **T-4 — tsc fixture types.** DONE. Route: INLINE. Both files' local
  `ProductInput.asset_class?: string` was stale (asset_class is an allocation
  array); changed to `{ name: string; percentage: number }[]`, clearing 11 tsc
  errors.

## Checks / evidence
- Web suite: **18 files / 165 passed / 0 failed** (was 159 passed / 6 failed).
- `tsc --noEmit` clean; eslint clean on the edited files.

## Next step
Feature complete.
