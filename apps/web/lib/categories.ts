import type { Category } from "@/lib/portfolio-types";

export interface CategoryMeta {
  key: Category;
  /** Full label — section headers, modal category dropdown. */
  label: string;
  /** Short label — tabs, card badges. Matches `portfolio-dashboard.spec.md`. */
  shortLabel: string;
  /** CSS custom property defined in `app/globals.css`. */
  cssVar: string;
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
  },
  privados: {
    key: "privados",
    label: "Mercados privados",
    shortLabel: "Merc. privados",
    cssVar: "--sabbi-cat-privados",
  },
  club: {
    key: "club",
    label: "Club deals",
    shortLabel: "Club deals",
    cssVar: "--sabbi-cat-club",
  },
  publicos: {
    key: "publicos",
    label: "Mercados públicos",
    shortLabel: "Merc. públicos",
    cssVar: "--sabbi-cat-publicos",
  },
  otros: {
    key: "otros",
    label: "Otros",
    shortLabel: "Otros",
    cssVar: "--sabbi-cat-otros",
  },
  cash: {
    key: "cash",
    label: "Cash y equivalentes",
    shortLabel: "Cash",
    cssVar: "--sabbi-cat-cash",
  },
};

export function categoryColorVar(category: Category): string {
  return `var(${CATEGORY_META[category].cssVar})`;
}
