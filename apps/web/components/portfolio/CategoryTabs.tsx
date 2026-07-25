import type { FC, ReactNode } from "react";
import { ASSET_CLASS_META, ASSET_CLASS_ORDER, assetClassColorVar } from "@/lib/categories";
import type { AssetClass } from "@/lib/portfolio-types";
import type { AssetClassFilter } from "@/lib/usePortfolio";

export interface AssetClassTabsProps {
  activeAssetClass: AssetClassFilter;
  onChange: (assetClass: AssetClassFilter) => void;
  totalCount: number;
  countsByAssetClass: Record<AssetClass, number>;
}

/**
 * "Todos" + one tab per asset class, each with a count badge. Filters which
 * asset class sections are visible below.
 * `portfolio-dashboard.spec.md` → "Filtrado por clase de activo con tabs".
 */
export const AssetClassTabs: FC<AssetClassTabsProps> = ({
  activeAssetClass,
  onChange,
  totalCount,
  countsByAssetClass,
}) => {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label="Filtrar por clase de activo"
    >
      <Tab
        active={activeAssetClass === "todos"}
        onClick={() => onChange("todos")}
      >
        Todos
        <Badge active={activeAssetClass === "todos"}>{totalCount}</Badge>
      </Tab>
      {ASSET_CLASS_ORDER.map((assetClass) => {
        const active = activeAssetClass === assetClass;
        return (
          <Tab
            key={assetClass}
            active={active}
            color={assetClassColorVar(assetClass)}
            onClick={() => onChange(assetClass)}
          >
            {ASSET_CLASS_META[assetClass].shortLabel}
            <Badge active={active}>{countsByAssetClass[assetClass] ?? 0}</Badge>
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
        ? color
          ? {
              backgroundColor: `color-mix(in srgb, ${color} 15%, white)`,
              color,
              borderColor: color,
            }
          : { backgroundColor: "var(--sabbi-lime)" }
        : undefined
    }
    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? color
          ? "border"
          : "border-transparent text-sabbi-neutral-900"
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
