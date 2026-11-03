/**
 * Pure helpers for the Ficha Patrimonial review table
 * (`sdd/admin-ficha-patrimonial/spec` -> "Review Table Editing", "Unmapped
 * row blocks confirm"). Kept side-effect-free so row-mapping, asset-class
 * validation, and confirm-payload building are unit-testable without mounting
 * `ReviewTable`.
 */

import type {
  AssetAllocation,
  CatalogSeriesOption,
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

/** One row's editable review state. */
export interface EditableFichaRow {
  excelRow: number;
  name: string;
  amount: string;
  currency: string;
  assetClass: FichaAssetClassKey | "";
  geographicFocus: AssetAllocation[];
  underlying: AssetAllocation[];
  commission: string;
  administrator: string;
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

/**
 * Derives the Slice-1 confidence badge from the enrichment source: a catalog
 * match is the most trustworthy, Claude knowledge is medium, a web search is
 * low, and no match means no data. This is a frontend derivation — Slice 2 may
 * later replace it with a backend-computed confidence score.
 */
const CONFIDENCE_BY_SOURCE: Record<RowSource, ConfidenceBadge> = {
  catalog: {
    level: "alta",
    label: "Confianza alta",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  claude_knowledge: {
    level: "media",
    label: "Confianza media",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  web_search: {
    level: "baja",
    label: "Confianza baja",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  not_found: {
    level: "sin_datos",
    label: "Sin datos",
    className: "border-sabbi-neutral-200 bg-sabbi-neutral-100 text-sabbi-neutral-600",
  },
};

export function deriveConfidence(source: RowSource): ConfidenceBadge {
  return CONFIDENCE_BY_SOURCE[source];
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
 * Maps a parsed+enriched row into its initial editable review state.
 */
export function toEditableRow(row: FichaEnrichedRow): EditableFichaRow {
  return {
    excelRow: row.excel_row,
    name: row.enriched?.name || row.raw_name,
    amount: String(row.raw_amount ?? ""),
    currency: row.raw_currency || row.enriched?.currency || "",
    assetClass: resolveAssetClassKey(row),
    geographicFocus: row.enriched?.geographic_focus ?? [],
    underlying: row.enriched?.underlying ?? [],
    commission: row.enriched?.commission ?? "",
    administrator: row.enriched?.administrator ?? "",
    liquidity: row.enriched?.liquidity ?? "",
    returnRateMin: row.normalized_return_rate || row.enriched?.return_rate || "",
    returnRateMax: "",
    source: resolveRowSource(row),
    enriched: row.enriched,
    seriesOptions: row.enriched?.series_options ?? [],
    selectedSeries: "",
    selectedAdministrator: "",
    editableSeries: toEditableSeriesRows(row.enriched?.series_options ?? []),
  };
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
      manager: row.enriched?.manager ?? "",
      liquidity: row.liquidity,
      return_rate: returnRate,
      catalog_product_id: row.enriched?.catalog_product_id ?? null,
    };
  });
}
