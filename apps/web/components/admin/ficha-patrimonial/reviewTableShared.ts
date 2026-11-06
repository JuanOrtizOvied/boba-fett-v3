/**
 * Pure helpers for the Ficha Patrimonial review table
 * (`sdd/admin-ficha-patrimonial/spec` -> "Review Table Editing", "Unmapped
 * row blocks confirm"). Kept side-effect-free so row-mapping, asset-class
 * validation, and confirm-payload building are unit-testable without mounting
 * `ReviewTable`.
 */

import type {
  AssetAllocation,
  CatalogAdminUpdate,
  CatalogHistoryEntry,
  CatalogSeriesOption,
  CatalogSeriesUpdate,
  FichaApproveRequest,
  FichaEnrichedRow,
} from "@/lib/portfolio-types";

export type FichaAssetClassKey =
  | "inmobiliario_directo"
  | "mercados_publicos_fijo"
  | "mercados_publicos_variable"
  | "mercados_privados"
  | "club_deal"
  | "cash_y_otros";

export const ASSET_CLASS_LABELS: Record<FichaAssetClassKey, string> = {
  inmobiliario_directo: "Inmobiliario Directo",
  mercados_publicos_fijo: "Mercados Publicos - Fijo",
  mercados_publicos_variable: "Mercados Publicos - Variable",
  mercados_privados: "Mercados Privados",
  club_deal: "Club Deal",
  cash_y_otros: "Cash y Otros",
};


/**
 * Maps free-form asset_class names from the catalog DB to canonical keys.
 * Normalizes case, accents, dashes, and singular/plural.
 */
function normalizeAssetClass(name: string): FichaAssetClassKey | "" {
  const n = name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .trim();

  if (n.includes("inmobiliario") || n.includes("inversiones directa"))
    return "inmobiliario_directo";
  if (n.includes("publico") && (n.includes("fijo") || n.includes("renta fija")))
    return "mercados_publicos_fijo";
  if (n.includes("publico") && (n.includes("variable") || n.includes("renta variable")))
    return "mercados_publicos_variable";
  if (n.includes("privado"))
    return "mercados_privados";
  if (n.includes("club"))
    return "club_deal";
  if (n.includes("cash") || n.includes("efectivo"))
    return "cash_y_otros";

  return "";
}

function resolveAssetClassKey(row: FichaEnrichedRow): FichaAssetClassKey | "" {
  const enrichedAc = row.enriched?.asset_class;
  if (enrichedAc?.length) {
    const mapped = normalizeAssetClass(enrichedAc[0].name);
    if (mapped) return mapped;
  }
  if (row.mapped_asset_class) {
    const mapped = normalizeAssetClass(row.mapped_asset_class);
    if (mapped) return mapped;
  }
  return "";
}

/** Match-quality source of a row's enrichment. */
export type RowSource = "catalog" | "claude_knowledge" | "web_search" | "not_found";

export const SOURCE_BADGES: Record<RowSource, { label: string; className: string }> = {
  catalog: {
    label: "Catálogo",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  claude_knowledge: {
    label: "Conocimiento Claude",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  web_search: {
    label: "Búsqueda web",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  not_found: {
    label: "Sin coincidencia",
    className: "border-sabbi-neutral-200 bg-sabbi-neutral-100 text-sabbi-neutral-600",
  },
};

/**
 * One editable row of the validation card's Series table — the catalog series
 * values the admin can review/correct. Numeric catalog fields are held as plain
 * percent-value strings (e.g. "3.84"); `minimumUsd` and `howCalculated` have no
 * series-level catalog source in Slice 1 and start blank.
 */
export interface EditableSeriesRow {
  series: string;
  ter: string;
  flowsMin: string;
  flowsMax: string;
  returnMin: string;
  returnMax: string;
  minimumUsd: string;
  howCalculated: string;
}

/**
 * One editable row of the card's Administradores table — a series administrator
 * the admin can review/correct. `custody`/`buy`/`sell` are plain percent-value
 * strings (fractions ×100); `minimumUsd` is an absolute amount.
 */
export interface EditableAdminRow {
  administrator: string;
  series: string;
  custody: string;
  buy: string;
  sell: string;
  minimumUsd: string;
}

/**
 * Per-line validation state. `pending` = not yet decided, `approved` = the admin
 * accepted it (included in confirm), `discarded` = dropped (excluded).
 */
export type FichaLineStatus = "pending" | "approved" | "discarded";

/** One row's editable review state. */
export interface EditableFichaRow {
  excelRow: number;
  // Persisted ficha_line id (Slice 3b) — null for a freshly-parsed row.
  lineId: number | null;
  name: string;
  amount: string;
  currency: string;
  assetClass: FichaAssetClassKey | "";
  geographicFocus: AssetAllocation[];
  underlying: AssetAllocation[];
  commission: string;
  administrator: string;
  manager: string;
  liquidity: string;
  returnRateMin: string;
  returnRateMax: string;
  source: RowSource;
  enriched: FichaEnrichedRow["enriched"];
  // Ficha V2: series/admin options for this row (empty when the product was
  // not matched in the normalized catalog) and the admin's current pick.
  seriesOptions: CatalogSeriesOption[];
  selectedSeries: string;
  selectedAdministrator: string;
  // Editable copy of the catalog series values (the Series table).
  editableSeries: EditableSeriesRow[];
  // Editable copy of the catalog administrators (the Administradores table).
  editableAdmins: EditableAdminRow[];
  // Per-line validation decision.
  lineStatus: FichaLineStatus;
}

export function resolveRowSource(row: FichaEnrichedRow): RowSource {
  if (row.enrichment_failed || !row.enriched) return "not_found";
  return row.enriched.primary_source;
}

/** Confidence level shown on a validation card, derived from the match source. */
export type ConfidenceLevel = "alta" | "media" | "baja" | "sin_datos";

export interface ConfidenceBadge {
  level: ConfidenceLevel;
  label: string;
  className: string;
}

const CONFIDENCE_BADGES: Record<ConfidenceLevel, { label: string; className: string }> = {
  alta: {
    label: "Confianza alta",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  media: {
    label: "Confianza media",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  baja: {
    label: "Confianza baja",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  sin_datos: {
    label: "Sin datos",
    className: "border-sabbi-neutral-200 bg-sabbi-neutral-100 text-sabbi-neutral-600",
  },
};

const SOURCE_TO_LEVEL: Record<RowSource, ConfidenceLevel> = {
  catalog: "alta",
  claude_knowledge: "media",
  web_search: "baja",
  not_found: "sin_datos",
};

export function confidenceBadge(level: ConfidenceLevel): ConfidenceBadge {
  return { level, ...CONFIDENCE_BADGES[level] };
}

function isConfidenceLevel(value: string): value is ConfidenceLevel {
  return (
    value === "alta" ||
    value === "media" ||
    value === "baja" ||
    value === "sin_datos"
  );
}

/**
 * Source-derived confidence badge (catalog→alta, Claude→media, web→baja, none→
 * sin_datos). This is the Slice-1 fallback used when the backend omits a
 * confidence level; `resolveConfidence` prefers the backend value.
 */
export function deriveConfidence(source: RowSource): ConfidenceBadge {
  return confidenceBadge(SOURCE_TO_LEVEL[source]);
}

/**
 * Confidence badge for a row — prefers the backend-computed confidence level
 * (Slice 2, gated by match similarity) and falls back to the source-derived one.
 */
export function resolveConfidence(row: FichaEnrichedRow): ConfidenceBadge {
  const backend = row.enriched?.confidence;
  if (backend && isConfidenceLevel(backend)) return confidenceBadge(backend);
  return deriveConfidence(resolveRowSource(row));
}

/** Formats a 0..1 similarity as a rounded percent ("18%"); "" when not positive. */
export function formatSimilarityPercent(value: number | null | undefined): string {
  if (!value || value <= 0) return "";
  return `${Math.round(value * 100)}%`;
}

/**
 * Builds the read-only "declared" summary line shown on a card's left rail,
 * from the raw Excel values: "Soles · 10,294 · declara 4.13%". Blank parts and
 * a zero amount are omitted.
 */
export function formatDeclaredSummary(row: FichaEnrichedRow): string {
  const parts: string[] = [];
  if (row.raw_currency?.trim()) parts.push(row.raw_currency.trim());
  if (Number.isFinite(row.raw_amount) && row.raw_amount !== 0) {
    parts.push(row.raw_amount.toLocaleString("en-US"));
  }
  if (row.raw_return_rate?.trim()) {
    parts.push(`declara ${row.raw_return_rate.trim()}`);
  }
  return parts.join(" · ");
}

/** Format an `AssetAllocation[]` as editable text: "US 60%, Europe 40%". */
export function formatAllocations(allocations: AssetAllocation[] | undefined): string {
  if (!allocations || allocations.length === 0) return "";
  return allocations.map((a) => `${a.name} ${a.percentage}%`).join(", ");
}

/** Parse "US 60%, Europe 40%" back into `AssetAllocation[]`.
 *  A bare name without a percentage defaults to 100%. */
export function parseAllocations(text: string): AssetAllocation[] {
  if (!text.trim()) return [];
  return text.split(",").map((segment) => {
    const trimmed = segment.trim();
    const match = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)%?$/);
    if (match) return { name: match[1].trim(), percentage: Number(match[2]) };
    return { name: trimmed, percentage: 100 };
  });
}

/**
 * Maps the catalog series options into editable Series-table rows, formatting
 * the fraction fields as plain percent values. `minimumUsd`/`howCalculated`
 * have no series-level source yet and start blank.
 */
export function toEditableSeriesRows(
  options: CatalogSeriesOption[],
): EditableSeriesRow[] {
  return options.map((s) => ({
    series: s.series,
    ter: formatFractionValue(s.management_fee_ter),
    flowsMin: formatFractionValue(s.flows_min),
    flowsMax: formatFractionValue(s.flows_max),
    returnMin: formatFractionValue(s.return_min),
    returnMax: formatFractionValue(s.return_max),
    minimumUsd: "",
    howCalculated: "",
  }));
}

/**
 * Flattens every series' administrators into editable Administradores-table
 * rows, carrying the parent series. `custody`/`buy`/`sell` are formatted as
 * plain percent values; `minimumUsd` is an absolute amount.
 */
export function toEditableAdminRows(
  options: CatalogSeriesOption[],
): EditableAdminRow[] {
  return options.flatMap((s) =>
    s.administrators.map((a) => ({
      administrator: a.administrator,
      series: s.series,
      custody: formatFractionValue(a.custody_fee),
      buy: formatFractionValue(a.buy_commission),
      sell: formatFractionValue(a.sell_commission),
      minimumUsd: formatPlainNumber(a.minimum_usd),
    })),
  );
}

/**
 * Turns one V2-catalog change-history entry into human-readable lines for the
 * card's "Historial de cambios" section. A `create` entry is a single
 * "producto creado" line; an `update` entry lists each changed product-level
 * field, plus nested series (`Serie <name>: <field>`) and administrator
 * (`<admin / series>: <field>`) field changes.
 */
export function summarizeCatalogHistoryEntry(
  entry: CatalogHistoryEntry,
): string[] {
  if (entry.action === "create") {
    const seriesNames = Array.isArray(
      (entry.changes as Record<string, unknown>).series,
    )
      ? ((entry.changes as Record<string, unknown>).series as string[])
      : [];
    const suffix = seriesNames.length ? ` (series: ${seriesNames.join(", ")})` : "";
    return [`Producto creado en el catálogo${suffix}`];
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(entry.changes ?? {})) {
    if (key === "series" && value && typeof value === "object") {
      for (const [seriesName, fields] of Object.entries(
        value as Record<string, Record<string, unknown>>,
      )) {
        for (const field of Object.keys(fields)) {
          lines.push(`Serie ${seriesName}: ${field}`);
        }
      }
    } else if (key === "administrators" && value && typeof value === "object") {
      for (const [adminKey, fields] of Object.entries(
        value as Record<string, Record<string, unknown>>,
      )) {
        for (const field of Object.keys(fields)) {
          lines.push(`${adminKey}: ${field}`);
        }
      }
    } else {
      lines.push(key);
    }
  }
  return lines;
}

/** An empty editable series row — the admin fills it in for a brand-new
 * (not-in-catalog) product via the "+ agregar serie" control. */
export function blankEditableSeriesRow(): EditableSeriesRow {
  return {
    series: "",
    ter: "",
    flowsMin: "",
    flowsMax: "",
    returnMin: "",
    returnMax: "",
    minimumUsd: "",
    howCalculated: "",
  };
}

/** An empty editable administrator row — the admin fills it in for a brand-new
 * (not-in-catalog) product via the "+ agregar administrador" control. */
export function blankEditableAdminRow(): EditableAdminRow {
  return {
    administrator: "",
    series: "",
    custody: "",
    buy: "",
    sell: "",
    minimumUsd: "",
  };
}

/**
 * Maps a parsed+enriched row into its initial editable review state.
 */
export function toEditableRow(row: FichaEnrichedRow): EditableFichaRow {
  return {
    excelRow: row.excel_row,
    lineId: row.line_id ?? null,
    name: row.enriched?.name || row.raw_name,
    amount: String(row.raw_amount ?? ""),
    currency: row.raw_currency || row.enriched?.currency || "",
    assetClass: resolveAssetClassKey(row),
    geographicFocus: row.enriched?.geographic_focus ?? [],
    underlying: row.enriched?.underlying ?? [],
    commission: row.enriched?.commission ?? "",
    administrator: row.enriched?.administrator ?? "",
    manager: row.enriched?.manager ?? "",
    liquidity: row.enriched?.liquidity ?? "",
    returnRateMin: row.normalized_return_rate || row.enriched?.return_rate || "",
    returnRateMax: "",
    source: resolveRowSource(row),
    enriched: row.enriched,
    seriesOptions: row.enriched?.series_options ?? [],
    selectedSeries: "",
    selectedAdministrator: "",
    editableSeries: toEditableSeriesRows(row.enriched?.series_options ?? []),
    editableAdmins: toEditableAdminRows(row.enriched?.series_options ?? []),
    lineStatus: "pending",
  };
}

/**
 * Merges a web re-investigation result (`researchFichaLine`) into an edited row.
 * OVERWRITES each product field with the web value WHEN the web result has one
 * (Option A — the admin explicitly asked Claude to search, so the form reflects
 * Claude's findings; the admin can still edit afterwards). A field the web result
 * left empty keeps its current value. ALWAYS refreshes the `enriched` block
 * (Fuentes + confidence + per-field `field_confidence`) and the source badge
 * ("Búsqueda web"). Returns the patch to apply.
 */
export function applyResearchToRow(
  row: EditableFichaRow,
  result: NonNullable<FichaEnrichedRow["enriched"]>,
): Partial<EditableFichaRow> {
  const patch: Partial<EditableFichaRow> = {
    enriched: result,
    source: "web_search",
  };
  if (result.name) patch.name = result.name;
  if (result.manager) patch.manager = result.manager;
  if (result.currency) patch.currency = result.currency;
  if (result.commission) patch.commission = result.commission;
  if (result.return_rate) patch.returnRateMin = result.return_rate;
  if (result.geographic_focus?.length) patch.geographicFocus = result.geographic_focus;
  if (result.underlying?.length) patch.underlying = result.underlying;
  if (result.asset_class?.length) {
    const key = normalizeAssetClass(result.asset_class[0].name);
    if (key) patch.assetClass = key;
  }
  return patch;
}

/** Returns only the rows the admin approved — the ones a confirm will create. */
export function selectApprovedRows(rows: EditableFichaRow[]): EditableFichaRow[] {
  return rows.filter((row) => row.lineStatus === "approved");
}

/**
 * Converts a catalog fraction (0.0384) to its percent value as a trimmed number
 * string ("3.84"). Returns null for an unknown value (null/undefined), so the
 * callers can distinguish "no value" from "0%".
 */
function fractionToPercentNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const pct = value * 100;
  // Round to 4 decimals to avoid float noise (0.0384 * 100 = 3.8400000000000003).
  const rounded = Math.round(pct * 10000) / 10000;
  return `${rounded}`;
}

/**
 * Formats a catalog fraction (0.0384) as a percent string ("3.84%"), trimming
 * trailing zeros. Returns "" for null/undefined (an unknown value, not 0%).
 */
export function formatFractionAsPercent(value: number | null | undefined): string {
  const n = fractionToPercentNumber(value);
  return n === null ? "" : `${n}%`;
}

/**
 * Like `formatFractionAsPercent` but without the "%" sign — the plain percent
 * value shown in the editable Series/Administradores tables ("3.84"). Returns
 * "" for an unknown value.
 */
export function formatFractionValue(value: number | null | undefined): string {
  return fractionToPercentNumber(value) ?? "";
}

/**
 * Formats an absolute number (e.g. a `minimum_usd` amount) as-is, WITHOUT the
 * ×100 scaling the fraction helpers apply. Returns "" for an unknown value.
 */
export function formatPlainNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `${value}`;
}

/**
 * Computes the editable-row patch when the admin picks a series/administrator
 * in the V2 review table. The series supplies the commission
 * (`management_fee_ter`) and the return range; the administrator supplies its
 * name. Commercial fields are only set from an actual pick — never guessed.
 * An unknown series yields just the selection (no field changes).
 */
export function applySeriesAdminSelection(
  row: EditableFichaRow,
  series: string,
  administrator: string,
): Partial<EditableFichaRow> {
  const seriesOption = row.seriesOptions.find((s) => s.series === series);
  if (!seriesOption) {
    return { selectedSeries: series, selectedAdministrator: administrator };
  }
  const adminOption = seriesOption.administrators.find(
    (a) => a.administrator === administrator,
  );
  return {
    selectedSeries: series,
    selectedAdministrator: adminOption ? administrator : "",
    commission: formatFractionAsPercent(seriesOption.management_fee_ter),
    returnRateMin: formatFractionAsPercent(seriesOption.return_min),
    returnRateMax: formatFractionAsPercent(seriesOption.return_max),
    administrator: adminOption ? adminOption.administrator : "",
  };
}

/** True when at least one row still needs a manual asset-class selection. */
export function hasUnmappedRow(rows: EditableFichaRow[]): boolean {
  return rows.some((row) => row.assetClass === "");
}

/** One product entry of the confirm payload. */
export interface FichaConfirmProduct {
  name: string;
  provider: string;
  amount: number;
  underlying: AssetAllocation[];
  asset_class: AssetAllocation[];
  geographic_focus: AssetAllocation[];
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  catalog_product_id: number | null;
}

/**
 * Builds the confirm payload from admin-edited rows.
 */
export function buildConfirmProducts(
  rows: EditableFichaRow[],
): FichaConfirmProduct[] {
  return rows.map((row) => {
    const returnRate = row.returnRateMax
      ? `${row.returnRateMin} - ${row.returnRateMax}`
      : row.returnRateMin;
    return {
      name: row.name,
      provider: "",
      amount: Number(row.amount) || 0,
      underlying: row.underlying,
      asset_class: row.assetClass
        ? [{ name: row.assetClass, percentage: 100 }]
        : [],
      geographic_focus: row.geographicFocus,
      commission: row.commission,
      currency: row.currency,
      administrator: row.administrator,
      manager: row.manager,
      liquidity: row.liquidity,
      return_rate: returnRate,
      catalog_product_id: row.enriched?.catalog_product_id ?? null,
    };
  });
}

/** Parses a plain percent value ("3.84") to a fraction (0.0384); null if blank
 * or non-numeric. Inverse of `formatFractionValue`. */
export function percentToFraction(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
}

function parsePlainNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds the per-line approve payload from an edited row: the client holding
 * (reused from `buildConfirmProducts`), the matched catalog code, and the edited
 * product/series/admin values converted back to catalog fractions.
 */
export function buildApproveRequest(
  row: EditableFichaRow,
  userId: string,
): FichaApproveRequest {
  const [product] = buildConfirmProducts([row]);
  const series: CatalogSeriesUpdate[] = row.editableSeries.map((s) => ({
    series: s.series,
    management_fee_ter: percentToFraction(s.ter),
    flows_min: percentToFraction(s.flowsMin),
    flows_max: percentToFraction(s.flowsMax),
    return_min: percentToFraction(s.returnMin),
    return_max: percentToFraction(s.returnMax),
  }));
  const admins: CatalogAdminUpdate[] = row.editableAdmins.map((a) => ({
    series: a.series,
    administrator: a.administrator,
    custody_fee: percentToFraction(a.custody),
    buy_commission: percentToFraction(a.buy),
    sell_commission: percentToFraction(a.sell),
    minimum_usd: parsePlainNumber(a.minimumUsd),
    min_commission_usd: null,
  }));
  return {
    user_id: userId,
    product: product as unknown as Record<string, unknown>,
    catalog_product_code: row.enriched?.catalog_product_code ?? "",
    catalog_update: {
      name: row.name,
      manager: row.manager,
      currency: row.currency,
      asset_class: row.assetClass
        ? [{ name: row.assetClass, percentage: 100 }]
        : [],
      geographic_focus: row.geographicFocus,
      underlying: row.underlying,
    },
    series,
    admins,
  };
}
