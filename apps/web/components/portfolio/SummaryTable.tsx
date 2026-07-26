import type { FC } from "react";
import { ASSET_CLASS_META, ASSET_CLASS_ORDER, assetClassColorVar, resolveAssetClassKey } from "@/lib/categories";
import type { Product } from "@/lib/portfolio-types";

export interface SummaryTableProps {
  products: Product[];
  totalAmount: number;
}

/** A product's proportional contribution (by amount) to one asset class. */
interface AssetClassContribution {
  product: Product;
  amount: number;
}

interface AssetClassGroupData {
  assetClassKey: (typeof ASSET_CLASS_ORDER)[number];
  contributions: AssetClassContribution[];
  assetClassTotal: number;
}

/**
 * Consolidated resumen-final table: one highlighted row per asset class (badge +
 * label + actual % of the whole portfolio) followed by one indented row per
 * product (actual % + progress bar relative to its own asset class), and a bold
 * total row whose "Actual" column sums to 100.0%.
 *
 * "Retorno" and "Deseado %" are not sourced anywhere yet (no return/target
 * data model exists) — both columns render "—" per the spec's deferred scope.
 * `portfolio-dashboard.spec.md` → "Tabla consolidada del resumen".
 */
export const SummaryTable: FC<SummaryTableProps> = ({ products, totalAmount }) => {
  const groups: AssetClassGroupData[] = ASSET_CLASS_ORDER.map((assetClassKey) => {
    const contributions: AssetClassContribution[] = [];
    for (const p of products) {
      for (const alloc of p.asset_class ?? []) {
        if (resolveAssetClassKey(alloc.name) === assetClassKey) {
          contributions.push({ product: p, amount: (p.amount * alloc.percentage) / 100 });
        }
      }
    }
    const assetClassTotal = contributions.reduce((sum, c) => sum + c.amount, 0);
    return { assetClassKey, contributions, assetClassTotal };
  }).filter((group) => group.contributions.length > 0);

  const totalActualPercent =
    totalAmount > 0
      ? groups.reduce((sum, group) => sum + (group.assetClassTotal / totalAmount) * 100, 0)
      : 0;

  return (
    <section className="overflow-hidden rounded-xl border border-sabbi-neutral-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-sabbi-neutral-50 text-xs font-medium text-sabbi-neutral-600">
            <th className="px-4 py-2 text-left">Clase de activo</th>
            <th className="px-4 py-2 text-right">Actual %</th>
            <th className="px-4 py-2 text-right">Retorno</th>
            <th className="px-4 py-2 text-right">Deseado %</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, index) => {
            const meta = ASSET_CLASS_META[group.assetClassKey];
            const assetClassPercent =
              totalAmount > 0 ? (group.assetClassTotal / totalAmount) * 100 : 0;
            return (
              <AssetClassRows
                key={group.assetClassKey}
                index={index}
                label={meta.label}
                color={assetClassColorVar(group.assetClassKey)}
                assetClassPercent={assetClassPercent}
                assetClassTotal={group.assetClassTotal}
                contributions={group.contributions}
              />
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-sabbi-neutral-900 bg-sabbi-neutral-50 font-semibold text-sabbi-neutral-900">
            <td className="px-4 py-3">Total</td>
            <td className="px-4 py-3 text-right">{totalActualPercent.toFixed(1)}%</td>
            <td className="px-4 py-3 text-right text-sabbi-neutral-500">—</td>
            <td className="px-4 py-3 text-right text-sabbi-neutral-500">—</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
};

function aggregateUnderlying(contributions: AssetClassContribution[], assetClassTotal: number) {
  const map = new Map<string, number>();
  for (const c of contributions) {
    const weight = assetClassTotal > 0 ? c.amount / assetClassTotal : 0;
    for (const a of c.product.underlying) {
      map.set(a.name, (map.get(a.name) ?? 0) + weight * a.percentage);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, pct]) => ({ name, percentage: pct }));
}

const AssetClassRows: FC<{
  index: number;
  label: string;
  color: string;
  assetClassPercent: number;
  assetClassTotal: number;
  contributions: AssetClassContribution[];
}> = ({ index, label, color, assetClassPercent, assetClassTotal, contributions }) => {
  const compositionRows = aggregateUnderlying(contributions, assetClassTotal);
  return (
    <>
      <tr className="bg-sabbi-neutral-100/70">
        <td className="px-4 py-2">
          <div className="flex items-center gap-2">
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {index + 1}
            </span>
            <span className="font-medium text-sabbi-neutral-900">{label}</span>
          </div>
        </td>
        <td className="px-4 py-2 text-right font-medium text-sabbi-neutral-900">
          {assetClassPercent.toFixed(1)}%
        </td>
        <td className="px-4 py-2 text-right text-sabbi-neutral-500">—</td>
        <td className="px-4 py-2 text-right text-sabbi-neutral-500">—</td>
      </tr>
      {compositionRows.map((row) => (
        <tr key={row.name}>
          <td className="px-4 py-1.5 pl-10">
            <div className="flex flex-col gap-1">
              <span className="truncate text-xs text-sabbi-neutral-600">
                {row.name}
              </span>
              <div className="h-1 w-32 overflow-hidden rounded-full bg-sabbi-neutral-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${row.percentage}%`, backgroundColor: color }}
                />
              </div>
            </div>
          </td>
          <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-600">
            {row.percentage.toFixed(1)}%
          </td>
          <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-400">—</td>
          <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-400">—</td>
        </tr>
      ))}
    </>
  );
};
