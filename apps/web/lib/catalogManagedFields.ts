import type { CatalogProduct } from "@/lib/portfolio-types";

/** Hint shown under a field the Excel owns (catalog-excel-managed-fields
 * spec, EM-01). */
export const EXCEL_MANAGED_HINT = "Este campo se edita desde el Excel";

/**
 * Whether `key` must be read-only in the catalog edit modal for `entry`.
 *
 * Only entries that have a `codigo` are Excel-managed; an entry without one
 * is fully editable (EM-03). `managedFields` is the list served by
 * `GET /admin/catalog/excel-managed-fields`, so the set follows
 * `FIELD_MAPPING` with no frontend change (EM-04). Until that list loads it
 * is empty, which leaves every field editable.
 */
export function isFieldReadOnly(
  entry: Pick<CatalogProduct, "codigo"> | null,
  managedFields: readonly string[],
  key: string,
): boolean {
  if (!entry?.codigo) return false;
  return managedFields.includes(key);
}
