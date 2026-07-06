import type { FC, ReactNode } from "react";
import { CATEGORY_META, CATEGORY_ORDER, categoryColorVar } from "@/lib/categories";
import type { Category } from "@/lib/portfolio-types";
import type { CategoryFilter } from "@/lib/usePortfolio";

export interface CategoryTabsProps {
  activeCategory: CategoryFilter;
  onChange: (category: CategoryFilter) => void;
  totalCount: number;
  countsByCategory: Record<Category, number>;
}

/**
 * "Todos" + one tab per category, each with a count badge. Filters which
 * category sections are visible below.
 * `portfolio-dashboard.spec.md` → "Filtrado por categoría con tabs".
 */
export const CategoryTabs: FC<CategoryTabsProps> = ({
  activeCategory,
  onChange,
  totalCount,
  countsByCategory,
}) => {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label="Filtrar por categoría"
    >
      <Tab
        active={activeCategory === "todos"}
        onClick={() => onChange("todos")}
      >
        Todos
        <Badge active={activeCategory === "todos"}>{totalCount}</Badge>
      </Tab>
      {CATEGORY_ORDER.map((category) => {
        const active = activeCategory === category;
        return (
          <Tab
            key={category}
            active={active}
            color={categoryColorVar(category)}
            onClick={() => onChange(category)}
          >
            {CATEGORY_META[category].shortLabel}
            <Badge active={active}>{countsByCategory[category] ?? 0}</Badge>
          </Tab>
        );
      })}
    </div>
  );
};

const Tab: FC<{
  active: boolean;
  color?: string;
  onClick: () => void;
  children: ReactNode;
}> = ({ active, color, onClick, children }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    style={
      active
        ? {
            backgroundColor: color ? `color-mix(in srgb, ${color} 15%, white)` : undefined,
            color,
            borderColor: color,
          }
        : undefined
    }
    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? color
          ? "border"
          : "border-transparent bg-sabbi-primary-soft text-sabbi-primary"
        : "border-sabbi-neutral-200 text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"
    }`}
  >
    {children}
  </button>
);

const Badge: FC<{ active: boolean; children: ReactNode }> = ({ active, children }) => (
  <span
    className={`rounded-full px-1.5 py-0.5 text-xs ${
      active ? "bg-white/70" : "bg-sabbi-neutral-100"
    }`}
  >
    {children}
  </span>
);
