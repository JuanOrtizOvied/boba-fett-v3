import {
  formatFraction,
  formatUsd,
} from "@/components/admin/catalog-normalized/shared";
import { seriesName } from "@/lib/normalizedCatalogObservations";

/**
 * Change history of the normalized catalog sync, as the backend serves it
 * (`GET /api/admin/normalized-catalog/products/{code}/changes` and
 * `.../changes/summary`). These helpers type it, check its shape and word it
 * in Spanish. Everything here is read only.
 */

export const LIMA_TIME_ZONE = "America/Lima";

export type SyncAction = "create" | "update" | "delete" | "restore";
export type SyncLevel = "product" | "series" | "admin";

const ACTIONS: readonly SyncAction[] = ["create", "update", "delete", "restore"];

export interface SyncFieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

export interface SyncEvent {
  id: number;
  run_id: string;
  occurred_at: string;
  trigger: string;
  action: SyncAction;
  level: SyncLevel;
  product_code: string;
  series: string | null;
  administrator: string | null;
  changes: SyncFieldChange[];
}

/** A page of a product's events, newest first, and how many it has in all. */
export interface ProductHistoryPage {
  total: number;
  events: SyncEvent[];
}

/** What happened to one product on one day. */
export interface DayProduct {
  product_code: string;
  name: string;
  deleted: boolean;
  events: number;
  create: number;
  update: number;
  delete: number;
  restore: number;
}

export interface DaySummary {
  /** The Lima day it covers, `YYYY-MM-DD`. */
  date: string;
  totals: Record<SyncAction, number>;
  products: DayProduct[];
}

// -- Shape checks -------------------------------------------------------------
// The page must keep working when the backend answers something unexpected, so
// the responses are checked instead of trusted.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEvent(value: unknown): value is SyncEvent {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.run_id === "string" &&
    typeof value.occurred_at === "string" &&
    typeof value.trigger === "string" &&
    typeof value.product_code === "string" &&
    ACTIONS.includes(value.action as SyncAction) &&
    (value.level === "product" ||
      value.level === "series" ||
      value.level === "admin") &&
    Array.isArray(value.changes)
  );
}

export function parseProductHistory(data: unknown): ProductHistoryPage | null {
  if (!isRecord(data) || typeof data.total !== "number") return null;
  if (!Array.isArray(data.events) || !data.events.every(isEvent)) return null;
  return { total: data.total, events: data.events };
}

function isDayProduct(value: unknown): value is DayProduct {
  return (
    isRecord(value) &&
    typeof value.product_code === "string" &&
    typeof value.name === "string" &&
    typeof value.deleted === "boolean" &&
    typeof value.events === "number" &&
    ACTIONS.every((a) => typeof value[a] === "number")
  );
}

export function parseDaySummary(data: unknown): DaySummary | null {
  if (!isRecord(data) || typeof data.date !== "string") return null;
  const totals = data.totals;
  if (!isRecord(totals) || !ACTIONS.every((a) => typeof totals[a] === "number")) {
    return null;
  }
  if (!Array.isArray(data.products) || !data.products.every(isDayProduct)) {
    return null;
  }
  return {
    date: data.date,
    totals: totals as Record<SyncAction, number>,
    products: data.products,
  };
}

// -- Wording ------------------------------------------------------------------

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "1 cambio" / "3 cambios": the badge of a product and its line in the panel. */
export function changeCountLabel(count: number): string {
  return plural(count, "cambio", "cambios");
}

/** Header of the daily panel: `3 nuevos · 12 cambios · 1 eliminado`. Kinds with
 * no events are left out. */
export function totalsLabel(totals: Record<SyncAction, number>): string {
  const parts = [
    totals.create > 0 && plural(totals.create, "nuevo", "nuevos"),
    totals.update > 0 && plural(totals.update, "cambio", "cambios"),
    totals.delete > 0 && plural(totals.delete, "eliminado", "eliminados"),
    totals.restore > 0 && plural(totals.restore, "reactivado", "reactivados"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "sin cambios";
}

export function totalEvents(totals: Record<SyncAction, number>): number {
  return ACTIONS.reduce((sum, action) => sum + totals[action], 0);
}

/** What the line says about the event. A restore is the sync reactivating a row
 * the workbook still has; it is not presented as something a person did. */
export function actionLabel(action: SyncAction): string {
  switch (action) {
    case "create":
      return "Nuevo";
    case "update":
      return "Cambio";
    case "delete":
      return "Eliminado";
    case "restore":
      return "Reactivado por el sync";
  }
}

/** Which part of the product an event refers to. */
export function levelLabel(
  event: Pick<SyncEvent, "level" | "series" | "administrator">,
): string {
  if (event.level === "product") return "Producto";
  const series = `serie ${seriesName(event.series ?? "")}`;
  if (event.level === "series") return `Serie ${seriesName(event.series ?? "")}`;
  return `Administrador ${event.administrator ?? ""} (${series})`;
}

/** What started the run, in plain words. Shown discreetly. */
export function triggerLabel(trigger: string): string {
  switch (trigger) {
    case "webhook":
      return "aviso de SharePoint";
    case "scheduler":
      return "revisión programada";
    case "lifecycle":
      return "recuperación de avisos";
    case "manual":
      return "ejecución manual";
    case "web":
      return "desde la web";
    default:
      return trigger;
  }
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  ticker_isin: "Ticker / ISIN",
  manager: "Gestor",
  asset_class: "Clase de activo",
  geographic_focus: "Foco geográfico",
  underlying: "Subyacente",
  currency: "Moneda",
  investment_horizon: "Horizonte de inversión",
  management_fee_ter: "Comisión de gestión (TER)",
  flows_min: "Flujos mínimo",
  flows_max: "Flujos máximo",
  return_min: "Rentabilidad mínima",
  return_max: "Rentabilidad máxima",
  custody_fee: "Comisión de custodia",
  buy_commission: "Comisión de compra",
  sell_commission: "Comisión de venta",
  billing_currency: "Moneda de facturación",
  minimum_usd: "Mínimo (USD)",
  min_commission_usd: "Comisión mínima (USD)",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

const FRACTION_FIELDS = new Set([
  "management_fee_ter",
  "flows_min",
  "flows_max",
  "return_min",
  "return_max",
  "custody_fee",
  "buy_commission",
  "sell_commission",
]);
const USD_FIELDS = new Set(["minimum_usd", "min_commission_usd"]);

function isAllocation(value: unknown): value is { name: string; percentage: number } {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.percentage === "number"
  );
}

/** A stored value as the screen writes it: percentages for the fee fields, USD
 * for the minimums, `Name 60%` lists for allocations, "—" for nothing. */
export function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) {
    return value.length === 0
      ? "—"
      : value
          .map((item) =>
            isAllocation(item) ? `${item.name} ${item.percentage}%` : String(item),
          )
          .join(", ");
  }
  if (typeof value === "number") {
    if (FRACTION_FIELDS.has(field)) return formatFraction(value);
    if (USD_FIELDS.has(field)) return formatUsd(value);
  }
  return String(value);
}

// -- Lima time ----------------------------------------------------------------

const limaParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: LIMA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function limaFields(iso: string): Record<string, string> | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const fields: Record<string, string> = {};
  for (const part of limaParts.formatToParts(date)) fields[part.type] = part.value;
  return fields;
}

/** The Lima calendar day of an instant, `YYYY-MM-DD`. */
export function limaDay(iso: string): string {
  const f = limaFields(iso);
  return f ? `${f.year}-${f.month}-${f.day}` : "";
}

/** `10/11/2026 14:30`, in Lima time whatever the browser's own zone is. */
export function formatLimaDateTime(iso: string): string {
  const f = limaFields(iso);
  return f ? `${f.day}/${f.month}/${f.year} ${f.hour}:${f.minute}` : iso;
}

/** `2026-11-10` as `10/11/2026`. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${date}/${month}/${year}` : day;
}

// -- Cascades -----------------------------------------------------------------

export interface HistoryRow {
  event: SyncEvent;
  /** The series and administrator deletes the same run made along with a
   * product delete. Empty for every other event. */
  children: SyncEvent[];
}

/** Collapses the deletes a product delete took along under that delete. Works
 * over everything loaded so far: a child whose product delete is on a page not
 * loaded yet stays on its own until it arrives. */
export function groupCascades(events: readonly SyncEvent[]): HistoryRow[] {
  const parentKey = (e: SyncEvent) => `${e.run_id}|${e.product_code}`;
  const parents = new Set(
    events
      .filter((e) => e.action === "delete" && e.level === "product")
      .map(parentKey),
  );
  const childrenOf = new Map<string, SyncEvent[]>();
  const rows: HistoryRow[] = [];
  for (const event of events) {
    const isChild =
      event.action === "delete" &&
      event.level !== "product" &&
      parents.has(parentKey(event));
    if (isChild) {
      const key = parentKey(event);
      childrenOf.set(key, [...(childrenOf.get(key) ?? []), event]);
    }
  }
  for (const event of events) {
    const isChild =
      event.action === "delete" &&
      event.level !== "product" &&
      parents.has(parentKey(event));
    if (isChild) continue;
    const isParent = event.action === "delete" && event.level === "product";
    rows.push({
      event,
      children: isParent ? (childrenOf.get(parentKey(event)) ?? []) : [],
    });
  }
  return rows;
}

/** "2 series y 3 administradores" for the collapsed children of a delete. */
export function cascadeLabel(children: readonly SyncEvent[]): string {
  const series = children.filter((c) => c.level === "series").length;
  const admins = children.filter((c) => c.level === "admin").length;
  const parts = [
    series > 0 && plural(series, "serie", "series"),
    admins > 0 && plural(admins, "administrador", "administradores"),
  ].filter(Boolean);
  return parts.join(" y ");
}
