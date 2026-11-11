import {
  formatLimaDateTime,
  levelLabel,
  type SyncLevel,
} from "@/lib/normalized-sync-events";

/**
 * Rows of the workbook that the normalized sync could not apply, as the backend
 * serves them (`GET /api/admin/normalized-catalog/sync-issues`): a row with text
 * where a number belongs, a blank required cell, a repeated key, or a row whose
 * product or series was not found. The database keeps the last valid values until
 * the workbook is fixed. These helpers type the answer, check its shape and word
 * it in Spanish. Everything here is read only.
 */

export type IssueKind =
  | "non_numeric"
  | "blank_required"
  | "duplicate_key"
  | "no_parent"
  | "unreadable";

/** One bad cell of a row: what is wrong, where, and the text found there. */
export interface IssueProblem {
  kind: IssueKind | string;
  column: string;
  field: string;
  value: string;
}

export interface SyncIssue {
  id: number;
  sheet: string;
  level: SyncLevel;
  row_key: string;
  product_code: string | null;
  /** The product name when the product is known, even if it is deleted. */
  product_name: string | null;
  series: string | null;
  administrator: string | null;
  row_number: number;
  problems: IssueProblem[];
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  /** Who saved the workbook when the issue opened, as stored: an email, the marker
   * `unknown`, or null. */
  first_seen_by: string | null;
  resolved_by: string | null;
}

// -- Shape check --------------------------------------------------------------
// The page must keep working when the backend answers something unexpected, so
// the answer is checked instead of trusted.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProblem(value: unknown): value is IssueProblem {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.column === "string" &&
    typeof value.field === "string" &&
    typeof value.value === "string"
  );
}

const nullableString = (value: unknown) =>
  value === null || value === undefined || typeof value === "string";

function isIssue(value: unknown): value is SyncIssue {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.sheet === "string" &&
    (value.level === "product" ||
      value.level === "series" ||
      value.level === "admin") &&
    typeof value.row_key === "string" &&
    typeof value.row_number === "number" &&
    typeof value.first_seen_at === "string" &&
    Array.isArray(value.problems) &&
    value.problems.every(isProblem) &&
    nullableString(value.product_code) &&
    nullableString(value.product_name) &&
    nullableString(value.series) &&
    nullableString(value.administrator) &&
    nullableString(value.first_seen_by)
  );
}

export function parseSyncIssues(data: unknown): SyncIssue[] | null {
  if (!Array.isArray(data) || !data.every(isIssue)) return null;
  return data;
}

/** Open issues by product code. A row with an unreadable key has no code and is
 * only in the panel. */
export function issuesByProduct(
  issues: readonly SyncIssue[],
): Map<string, SyncIssue[]> {
  const byCode = new Map<string, SyncIssue[]>();
  for (const issue of issues) {
    if (!issue.product_code) continue;
    byCode.set(issue.product_code, [
      ...(byCode.get(issue.product_code) ?? []),
      issue,
    ]);
  }
  return byCode;
}

// -- Wording ------------------------------------------------------------------

/** "1 fila no leída" / "4 filas no leídas": the header of the panel. */
export function unreadRowsLabel(count: number): string {
  return `${count} ${count === 1 ? "fila no leída" : "filas no leídas"}`;
}

/** The badge of a product in the list. */
export function unreadBadgeLabel(count: number): string {
  return count === 1 ? "Fila no leída" : `${count} filas no leídas`;
}

const SHEET_LABELS: Record<string, string> = {
  "1. Productos": "Productos",
  "2. Producto x Serie": "Series",
  "3. Producto x Administrador": "Administradores",
};

/** The sheet of the workbook, as the owners call it. */
export function sheetLabel(sheet: string): string {
  return SHEET_LABELS[sheet] ?? sheet;
}

/** What is wrong with one cell, in Spanish. The text found is shown so the owner
 * knows what to look for ("se leyó «-»"). */
export function problemLabel(problem: IssueProblem): string {
  const found = problem.value ? ` (se leyó «${problem.value}»)` : "";
  switch (problem.kind) {
    case "non_numeric":
      return `Valor no numérico en «${problem.column}»${found}`;
    case "blank_required":
      return `Falta «${problem.column}»`;
    case "duplicate_key":
      return `Clave repetida en la hoja${found}`;
    case "no_parent":
      return "No se encontró el producto o la serie a la que pertenece";
    default:
      return problem.value || "No se pudo leer la fila";
  }
}

/** The sheet and row of an issue: "Series, fila 536". */
export function rowLabel(issue: Pick<SyncIssue, "sheet" | "row_number">): string {
  return `${sheetLabel(issue.sheet)}, fila ${issue.row_number}`;
}

/** Which part of the product the row is: "Producto", "Serie A" or
 * "Administrador Banco X (serie A)". */
export function issueLevelLabel(issue: SyncIssue): string {
  return levelLabel(issue);
}

/** When the sync first saw it, in Lima time: "10/11/2026 18:20". */
export function seenSince(issue: Pick<SyncIssue, "first_seen_at">): string {
  return formatLimaDateTime(issue.first_seen_at);
}
