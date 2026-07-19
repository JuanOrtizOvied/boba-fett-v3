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
  "directas",
  "privados",
  "club",
  "publicos",
  "otros",
  "cash",
];

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  directas: {
    key: "directas",
    label: "Inversiones directas",
    shortLabel: "Inv. directas",
    cssVar: "--sabbi-cat-directas",
    bgCssVar: "--sabbi-cat-directas-bg",
    textCssVar: "--sabbi-cat-directas-text",
  },
  privados: {
    key: "privados",
    label: "Mercados privados",
    shortLabel: "Merc. privados",
    cssVar: "--sabbi-cat-privados",
    bgCssVar: "--sabbi-cat-privados-bg",
    textCssVar: "--sabbi-cat-privados-text",
  },
  club: {
    key: "club",
    label: "Club deals",
    shortLabel: "Club deals",
    cssVar: "--sabbi-cat-club",
    bgCssVar: "--sabbi-cat-club-bg",
    textCssVar: "--sabbi-cat-club-text",
  },
  publicos: {
    key: "publicos",
    label: "Mercados públicos",
    shortLabel: "Merc. públicos",
    cssVar: "--sabbi-cat-publicos",
    bgCssVar: "--sabbi-cat-publicos-bg",
    textCssVar: "--sabbi-cat-publicos-text",
  },
  otros: {
    key: "otros",
    label: "Otros",
    shortLabel: "Otros",
    cssVar: "--sabbi-cat-otros",
    bgCssVar: "--sabbi-cat-otros-bg",
    textCssVar: "--sabbi-cat-otros-text",
  },
  cash: {
    key: "cash",
    label: "Cash y equivalentes",
    shortLabel: "Cash",
    cssVar: "--sabbi-cat-cash",
    bgCssVar: "--sabbi-cat-cash-bg",
    textCssVar: "--sabbi-cat-cash-text",
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
  directas: [
    { group: "RE Perú", leaves: ["Residencial", "Oficinas", "Comercial/Industrial"] },
    { group: "RE Extranjero", leaves: ["RE Extranjero"] },
  ],
  privados: [
    { group: "Deuda Privada", leaves: ["Deuda Privada"] },
    { group: "Private Equity", leaves: ["Private Equity"] },
    { group: "Venture Capital", leaves: ["Venture Capital"] },
    { group: "Real Estate", leaves: ["Real Estate"] },
    { group: "Hedge Funds", leaves: ["Hedge Funds"] },
    { group: "Infraestructura", leaves: ["Infraestructura"] },
  ],
  club: [
    { group: "Real Estate", leaves: ["Perú", "Extranjero"] },
    { group: "Deuda Privada", leaves: ["Perú", "Extranjero"] },
    { group: "Otros", leaves: ["Perú", "Extranjero"] },
  ],
  publicos: [
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
  cash: [{ group: "Cash", leaves: ["Depósitos a plazo", "Fondos de Money Market"] }],
};

const LABEL_TO_KEY: Record<string, Category> = {
  ...Object.fromEntries(
    Object.entries(CATEGORY_META).map(([key, meta]) => [meta.label.toLowerCase(), key as Category]),
  ),
  "real estate directo": "directas",
  "mercados privados": "privados",
  "club deals": "club",
  "mercados públicos": "publicos",
  "cash y equivalentes": "cash",
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
