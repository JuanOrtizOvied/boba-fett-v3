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

export function categoryColorVar(category: Category): string {
  return `var(${CATEGORY_META[category].cssVar})`;
}

export function categoryBgVar(category: Category): string {
  return `var(${CATEGORY_META[category].bgCssVar})`;
}

export function categoryTextVar(category: Category): string {
  return `var(${CATEGORY_META[category].textCssVar})`;
}
