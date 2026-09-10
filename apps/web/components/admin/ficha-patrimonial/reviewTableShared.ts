/**
 * Pure helpers for the Ficha Patrimonial review table
 * (`sdd/admin-ficha-patrimonial/spec` -> "Review Table Editing", "Unmapped
 * row blocks confirm"). Kept side-effect-free so row-mapping, asset-class
 * validation, and confirm-payload building are unit-testable without mounting
 * `ReviewTable`.
 */

import type { AssetAllocation, FichaEnrichedRow } from "@/lib/portfolio-types";

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
}

export function resolveRowSource(row: FichaEnrichedRow): RowSource {
  if (row.enrichment_failed || !row.enriched) return "not_found";
  return row.enriched.primary_source;
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
