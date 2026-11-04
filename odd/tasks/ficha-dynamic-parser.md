# Feature: Dynamic ficha Excel parser (header-driven)

- **Feature ID:** `ficha-dynamic-parser`
- **Branch:** `feat/ficha-delete` (implemented here alongside the delete feature).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`.

## Problem

A real uploaded ficha ("Ficha Patrimonial Sabbi-2") parsed 0 products: the old
`parse_ficha_excel` was hardcoded to fixed cells (products row 8, columns
C/J/K/M/N). The real file has the products header on row 11 and columns C-F, so
the fixed reader found nothing.

## Solution (header-driven detection + legacy fallback)

- `_find_products_header(ws)`: scans the first 40 rows for a header, mapping
  `name`/`amount` + (`currency` and/or `return`) columns by keyword (nombre/
  inversión/cuenta, moneda, valor/monto, rendimiento/rentabilidad). Requiring
  currency-or-return avoids matching the real-estate header.
- `_parse_products_dynamic`: reads rows below the header (by the detected
  columns) until a blank name or a "Total" row.
- `_parse_products_legacy`: the old fixed-cell reader — used as a fallback when
  no header is detected (keeps the header-less test fixture working).
- `_find_client_name`: best-effort — finds a "Nombres y Apellidos" label and
  takes the adjacent/next non-label value (the real file has the name floating
  below the label block, not in D5).
- Sheet "Sabbi" still required (the real file has it); the missing-sheet error
  is unchanged.

## Verification

- TDD: RED (new real-format test parsed 0) → GREEN. `test_ficha_patrimonial`
  26/26 (new real-layout test + all legacy fixture tests still pass via the
  fallback). Backend suite 351 passed / 145 skipped / 0 new; ruff clean.
- **Real-file probe:** `Ficha Patrimonial Sabbi-2 (1).xlsx` now parses **5
  products** (Scotiafondo Soles 10294/4.13%, Scotiafondo Dólares 5000/3.45%,
  Santander 105000/2.5%, BanBif 3400, Préstamo 15000) + client "EDUARDO".

## Known limits / follow-ups

- Client name is best-effort; email/phone are empty when the ficha has none (as
  this one does) — assigning a ficha to a client without an email is a separate
  open question.
- `raw_tipo_activo` is empty in the dynamic path (this layout has no "tipo"
  column) → rows start unmapped; the admin picks the asset class (as designed).
- Flows ("Necesidad de flujos") and client comments are present in the sheet and
  now locatable, but not yet surfaced — that's the deferred Slice 2b.
- Truly arbitrary (non-SABBI) layouts would need the LLM-extraction fallback
  (not built).
