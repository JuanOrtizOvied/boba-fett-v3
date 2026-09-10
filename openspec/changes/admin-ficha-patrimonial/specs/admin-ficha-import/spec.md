# Admin Ficha Patrimonial Import Specification

## Purpose

Let SABBI admins bulk-import an investor's portfolio from a "Ficha
Patrimonial" Excel file: upload, parse, enrich via `cascade_search`,
review/edit, and confirm as one atomic bulk product creation.

## Requirements

### Requirement: Ficha Parse Endpoint

`POST /admin/ficha-patrimonial/parse` MUST accept a base64-encoded `.xlsx`
payload in a JSON body from an authenticated admin and MUST return parsed
client info plus enriched product rows without persisting anything.

#### Scenario: Valid ficha parses successfully

- GIVEN an admin uploads a valid `.xlsx` with client info and N product rows
- WHEN the parse endpoint processes it
- THEN the response includes client info and N enriched rows, each with original + enriched fields, a match-quality badge, and a suggested asset_class

#### Scenario: Invalid or corrupt file rejected

- GIVEN an admin uploads a non-xlsx or corrupt file
- WHEN the parse endpoint attempts to read it
- THEN it MUST respond 400 with an actionable error and create no state

#### Scenario: Missing "Sabbi" sheet

- GIVEN an uploaded workbook has no sheet named "Sabbi"
- WHEN parsing is attempted
- THEN it MUST respond 400 naming the missing sheet

#### Scenario: Non-admin blocked

- GIVEN an unauthenticated or non-admin caller
- WHEN they call the parse endpoint
- THEN it MUST respond 401/403 and perform no parsing

### Requirement: Ficha Confirm Endpoint

`POST /admin/ficha-patrimonial/confirm` MUST accept admin-reviewed product
rows and a target user email, resolve the user, and create all products
atomically (all-or-nothing).

#### Scenario: Confirm creates all products

- GIVEN N reviewed rows and a resolvable target user email
- WHEN the admin confirms
- THEN all N products MUST be created under that user, tagged `source: "admin_ficha_import"`, and the response MUST include the created count

#### Scenario: Unknown email hard-fails

- GIVEN the target email matches no existing user
- WHEN confirm is called
- THEN it MUST respond 404/422 with a "user not found" error and create zero products

#### Scenario: One invalid row rejects the whole batch

- GIVEN one of N rows fails product validation (e.g. unresolved asset_class)
- WHEN confirm is called
- THEN the entire batch MUST be rejected with zero products created

### Requirement: Excel Parsing — Sabbi Sheet

The parser MUST read client info from row 5 and product rows starting at
row 8, stopping at the first blank row or a row containing "Total", and
MUST exclude real-estate rows (row 27+) from parsed products.

#### Scenario: Standard ficha parses expected row range

- GIVEN a sheet with client info in row 5 and 15 product rows (8-22) followed by a "Total" row
- WHEN the parser runs
- THEN it MUST return exactly 15 product rows and stop before "Total"

#### Scenario: Real estate rows excluded

- GIVEN rows 27+ contain real-estate data
- WHEN the parser runs
- THEN those rows MUST NOT appear in the returned product rows

#### Scenario: Column mapping is centralized

- GIVEN the template's product fields (description, provider, amount, "Pertenencia", return rate) live in columns C/J/K/L/M/N
- WHEN the parser reads a row
- THEN it MUST use named column constants from one module, not per-call literals

### Requirement: Return Rate Normalization

The parser MUST normalize return-rate input (percentage string, fractional
decimal, or bare percentage) into one consistent decimal-string format.

#### Scenario: Percentage string normalized

- GIVEN a cell value of "7.5%"
- WHEN normalized
- THEN the result MUST be "7.5"

#### Scenario: Fractional decimal normalized

- GIVEN a cell value of 0.08
- WHEN normalized
- THEN the result MUST be "8.0"

#### Scenario: Missing value tolerated

- GIVEN a blank return-rate cell
- WHEN normalized
- THEN the result MUST be null/empty, not an error

### Requirement: Batch Enrichment via cascade_search

The system MUST call `cascade_search()` once per parsed row, bounded by
`asyncio.Semaphore(3)` concurrent calls, and MUST merge enrichment results
with original Excel fields without discarding the originals.

#### Scenario: Concurrency bounded

- GIVEN a 15-row ficha
- WHEN enrichment runs
- THEN no more than 3 `cascade_search` calls MUST be in flight at once

#### Scenario: Per-row enrichment failure is isolated

- GIVEN one row's `cascade_search` call fails or times out
- WHEN enrichment completes
- THEN that row is returned with original Excel data, a low-confidence/no-match badge, and no enrichment fields, while other rows are unaffected

#### Scenario: High-confidence match pre-fills suggestions

- GIVEN `cascade_search` returns a high-confidence match for a row
- WHEN results are merged
- THEN the row MUST show a high match-quality badge with enriched fields editable by the admin

### Requirement: Asset Class Mapping

The system MUST map known "Tipo de activo" free-text values to one of the
six `ASSET_CLASSES` top-level keys via a fixed, hardcoded lookup table, and
MUST flag unrecognized values as unmapped rather than guessing.

| Free text | Mapped asset_class |
|---|---|
| Acciones en bolsa | mercados_publicos |
| Fondos mutuos | mercados_publicos |
| Cuenta ahorros | cash_y_equivalentes |
| Deposito plazo fijo | cash_y_equivalentes |
| Inversiones alternativas (PE/VC/etc) | mercados_privados |
| Otro / anything else not listed | unmapped |

#### Scenario: Known value maps directly

- GIVEN "Tipo de activo" = "Cuenta ahorros"
- WHEN the row is mapped
- THEN asset_class MUST pre-fill as `cash_y_equivalentes` at 100%

#### Scenario: Unknown value flagged, not guessed

- GIVEN "Tipo de activo" is not in the lookup table
- WHEN the row is mapped
- THEN it MUST be flagged "unmapped" with no asset_class default, requiring admin selection before that row can be confirmed

### Requirement: Pertenencia (Ownership) Column Is Informational Only

The "Pertenencia" column MUST be parsed and shown in the review table for
admin context but MUST NOT be persisted on the created product in v1.

#### Scenario: Ownership displayed but not stored

- GIVEN a row with Pertenencia = "Titular"
- WHEN the review table renders and the row is later confirmed
- THEN "Titular" MUST be visible read-only in the table and absent from the confirm payload and the created product

### Requirement: Target User Resolution by Email

The confirm endpoint MUST resolve the target user strictly by exact email
match (from ficha client info or an admin-edited email) and MUST hard-fail
with no auto-create if no matching user exists.

#### Scenario: Exact email match resolves user

- GIVEN the client email matches exactly one existing user
- WHEN confirm runs
- THEN products MUST be created under that user's id

#### Scenario: No matching user blocks import

- GIVEN the client email matches zero users
- WHEN confirm runs
- THEN it MUST fail with a clear "user not found" error instructing the admin to create the user first, creating zero products

### Requirement: Ficha Upload Page

`/admin/ficha-patrimonial` MUST provide a file picker restricted to
`.xlsx`, MUST show a loading state during parse+enrich (which MAY take up
to ~60s), and MUST render a review table on success.

#### Scenario: Successful upload renders review table

- GIVEN an admin selects a valid `.xlsx` and submits
- WHEN parse+enrich completes
- THEN a loading indicator MUST show first, then a review table with one row per parsed product

#### Scenario: Parse failure keeps page usable

- GIVEN parsing fails (invalid file, missing sheet, or non-admin)
- WHEN the error returns
- THEN the page MUST show the error and allow re-upload without a partial review table

### Requirement: Review Table Editing

Each review row MUST show original values, enriched values, a
match-quality badge, and an editable asset-class dropdown; unmapped rows
MUST be visually flagged and block confirmation until resolved.

#### Scenario: Unmapped row blocks confirm

- GIVEN a row is flagged "unmapped"
- WHEN the admin has not selected an asset_class for it
- THEN the confirm action MUST be disabled or MUST show a blocking validation message

#### Scenario: Manual edits override suggestions

- GIVEN an admin edits an enriched field in a row
- WHEN confirm is submitted
- THEN the edited value MUST be sent verbatim, overriding the original suggestion

### Requirement: Bulk Confirm and Success Summary

Confirming MUST call the confirm endpoint with all reviewed rows and the
resolved user. On success the admin MUST stay on the ficha page and see a
count-based success summary; on failure the review table MUST remain
populated and editable.

#### Scenario: Successful import shows summary, resets for next upload

- GIVEN all rows are valid and the user resolves
- WHEN confirm succeeds
- THEN the page MUST show "N products imported" and reset to allow a new upload

#### Scenario: Failed confirm preserves review state

- GIVEN confirm fails (e.g. user not found)
- WHEN the error returns
- THEN the review table MUST remain populated and editable so the admin can correct and retry
