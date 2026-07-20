import type { Category } from "@/lib/portfolio-types";

export interface CategoryMeta {
  key: Category;
  /** Full label — section headers, modal category dropdown. */
  label: string;
  /** Short label — tabs, card badges. Matches `portfolio-dashboard.spec.md`. */
  shortLabel: string;
  /** CSS custom property defined in `app/globals.css`. */
  cssVar: string;
  /** CSS custom property for the badge background color. */
  bgCssVar: string;
  /** CSS custom property for the badge text color. */
  textCssVar: string;
}

export const CATEGORY_ORDER: Category[] = [
  "inversiones_directas",
  "mercados_privados",
  "club_deals",
  "mercados_publicos",
  "otros",
  "cash_y_equivalentes",
];

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  inversiones_directas: {
    key: "inversiones_directas",
    label: "Inversiones directas",
    shortLabel: "Inv. directas",
    cssVar: "--sabbi-cat-inversiones_directas",
    bgCssVar: "--sabbi-cat-inversiones_directas-bg",
    textCssVar: "--sabbi-cat-inversiones_directas-text",
  },
  mercados_privados: {
    key: "mercados_privados",
    label: "Mercados privados",
    shortLabel: "Merc. privados",
    cssVar: "--sabbi-cat-mercados_privados",
    bgCssVar: "--sabbi-cat-mercados_privados-bg",
    textCssVar: "--sabbi-cat-mercados_privados-text",
  },
  club_deals: {
    key: "club_deals",
    label: "Club deals",
    shortLabel: "Club deals",
    cssVar: "--sabbi-cat-club_deals",
    bgCssVar: "--sabbi-cat-club_deals-bg",
    textCssVar: "--sabbi-cat-club_deals-text",
  },
  mercados_publicos: {
    key: "mercados_publicos",
    label: "Mercados públicos",
    shortLabel: "Merc. públicos",
    cssVar: "--sabbi-cat-mercados_publicos",
    bgCssVar: "--sabbi-cat-mercados_publicos-bg",
    textCssVar: "--sabbi-cat-mercados_publicos-text",
  },
  otros: {
    key: "otros",
    label: "Otros",
    shortLabel: "Otros",
    cssVar: "--sabbi-cat-otros",
    bgCssVar: "--sabbi-cat-otros-bg",
    textCssVar: "--sabbi-cat-otros-text",
  },
  cash_y_equivalentes: {
    key: "cash_y_equivalentes",
    label: "Cash y equivalentes",
    shortLabel: "Cash",
    cssVar: "--sabbi-cat-cash_y_equivalentes",
    bgCssVar: "--sabbi-cat-cash_y_equivalentes-bg",
    textCssVar: "--sabbi-cat-cash_y_equivalentes-text",
  },
};

export interface SubcategoryGroup {
  group: string;
  leaves: string[];
}

/**
 * 3-level subcategory taxonomy (category -> group -> leaf), mirroring the
 * backend's `CATEGORIES` in `apps/backend/src/agent/state.py`. Hardcoded here
 * rather than fetched — the taxonomy rarely changes and there is no endpoint
 * exposing it (`multi-level-search` design: "Frontend display" — the tool
 * result is already the data contract, no new endpoints).
 */
export const CATEGORY_SUBCATEGORIES: Record<Category, SubcategoryGroup[]> = {
  inversiones_directas: [
    { group: "RE Perú", leaves: ["Residencial", "Oficinas", "Comercial/Industrial"] },
    { group: "RE Extranjero", leaves: ["RE Extranjero"] },
  ],
  mercados_privados: [
    { group: "Deuda Privada", leaves: ["Deuda Privada"] },
    { group: "Private Equity", leaves: ["Private Equity"] },
    { group: "Venture Capital", leaves: ["Venture Capital"] },
    { group: "Real Estate", leaves: ["Real Estate"] },
    { group: "Hedge Funds", leaves: ["Hedge Funds"] },
    { group: "Infraestructura", leaves: ["Infraestructura"] },
  ],
  club_deals: [
    { group: "Real Estate", leaves: ["Perú", "Extranjero"] },
    { group: "Deuda Privada", leaves: ["Perú", "Extranjero"] },
    { group: "Otros", leaves: ["Perú", "Extranjero"] },
  ],
  mercados_publicos: [
    {
      group: "Renta Variable",
      leaves: ["US Large Cap", "US Mid & Small Cap", "Developed ex-US", "EM ex-Perú", "Perú"],
    },
    {
      group: "Renta Fija",
      leaves: [
        "US Treasuries",
        "IG Corporates AAA-BBB",
        "High Yield BB-",
        "EM Bonds",
        "LatAm Bonds",
        "Perú Bonds",
      ],
    },
  ],
  otros: [
    { group: "Cripto", leaves: ["Bitcoin", "Ethereum", "Otras"] },
    { group: "Commodities", leaves: ["Oro"] },
  ],
  cash_y_equivalentes: [{ group: "Cash", leaves: ["Depósitos a plazo", "Fondos de Money Market"] }],
};

const LABEL_TO_KEY: Record<string, Category> = {
  ...Object.fromEntries(
    Object.entries(CATEGORY_META).map(([key, meta]) => [meta.label.toLowerCase(), key as Category]),
  ),
  "real estate directo": "inversiones_directas",
  "mercados privados": "mercados_privados",
  "club deals": "club_deals",
  "mercados públicos": "mercados_publicos",
  "cash y equivalentes": "cash_y_equivalentes",
  // Legacy aliases — old keys that may still arrive from the database.
  "directas": "inversiones_directas",
  "privados": "mercados_privados",
  "club": "club_deals",
  "publicos": "mercados_publicos",
  "cash": "cash_y_equivalentes",
};

export function resolveCategoryKey(value: string): Category {
  if (value in CATEGORY_META) return value as Category;
  return LABEL_TO_KEY[value.toLowerCase()] ?? "otros";
}

export function categoryColorVar(category: Category): string {
  return `var(${CATEGORY_META[category].cssVar})`;
}

export function categoryBgVar(category: Category): string {
  return `var(${CATEGORY_META[category].bgCssVar})`;
}

export function categoryTextVar(category: Category): string {
  return `var(${CATEGORY_META[category].textCssVar})`;
}
