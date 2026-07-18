import type { FC } from "react";
import { CATEGORY_META, CATEGORY_ORDER, categoryColorVar } from "@/lib/categories";
import type { Product } from "@/lib/portfolio-types";

export interface SummaryTableProps {
  products: Product[];
  totalAmount: number;
}

interface CategoryGroupData {
  categoryKey: (typeof CATEGORY_ORDER)[number];
  products: Product[];
  categoryTotal: number;
}

/**
 * Consolidated resumen-final table: one highlighted row per category (badge +
 * label + actual % of the whole portfolio) followed by one indented row per
 * product (actual % + progress bar relative to its own category), and a bold
 * total row whose "Actual" column sums to 100.0%.
 *
 * "Retorno" and "Deseado %" are not sourced anywhere yet (no return/target
 * data model exists) — both columns render "—" per the spec's deferred scope.
 * `portfolio-dashboard.spec.md` → "Tabla consolidada del resumen".
 */
export const SummaryTable: FC<SummaryTableProps> = ({ products, totalAmount }) => {
  const groups: CategoryGroupData[] = CATEGORY_ORDER.map((categoryKey) => {
    const categoryProducts = products.filter((p) => p.category === categoryKey);
    const categoryTotal = categoryProducts.reduce((sum, p) => sum + p.amount, 0);
    return { categoryKey, products: categoryProducts, categoryTotal };
  }).filter((group) => group.products.length > 0);

  const totalActualPercent =
    totalAmount > 0
      ? groups.reduce((sum, group) => sum + (group.categoryTotal / totalAmount) * 100, 0)
      : 0;

  return (
    <section className="overflow-hidden rounded-xl border border-sabbi-neutral-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-sabbi-neutral-50 text-xs font-medium text-sabbi-neutral-600">
            <th className="px-4 py-2 text-left">Categoría</th>
            <th className="px-4 py-2 text-right">Actual %</th>
            <th className="px-4 py-2 text-right">Retorno</th>
            <th className="px-4 py-2 text-right">Deseado %</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group, index) => {
            const meta = CATEGORY_META[group.categoryKey];
            const categoryPercent =
              totalAmount > 0 ? (group.categoryTotal / totalAmount) * 100 : 0;
            return (
              <CategoryRows
                key={group.categoryKey}
                index={index}
                label={meta.label}
                color={categoryColorVar(group.categoryKey)}
                categoryPercent={categoryPercent}
                categoryTotal={group.categoryTotal}
                products={group.products}
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

const CategoryRows: FC<{
  index: number;
  label: string;
  color: string;
  categoryPercent: number;
  categoryTotal: number;
  products: Product[];
}> = ({ index, label, color, categoryPercent, categoryTotal, products }) => {
  const subcategoryGroups = new Map<string, Product[]>();
  for (const product of products) {
    const key = product.subcategory || "Sin subcategoría";
    const group = subcategoryGroups.get(key);
    if (group) group.push(product);
    else subcategoryGroups.set(key, [product]);
  }

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
          {categoryPercent.toFixed(1)}%
        </td>
        <td className="px-4 py-2 text-right text-sabbi-neutral-500">—</td>
        <td className="px-4 py-2 text-right text-sabbi-neutral-500">—</td>
      </tr>
      {Array.from(subcategoryGroups.entries()).map(([subcategory, subProducts]) => {
        const subTotal = subProducts.reduce((sum, p) => sum + p.amount, 0);
        const subPercent =
          categoryTotal > 0 ? (subTotal / categoryTotal) * 100 : 0;
        return (
          <SubcategoryRows
            key={subcategory}
            subcategory={subcategory}
            color={color}
            subPercent={subPercent}
            categoryTotal={categoryTotal}
            products={subProducts}
          />
        );
      })}
    </>
  );
};

const SubcategoryRows: FC<{
  subcategory: string;
  color: string;
  subPercent: number;
  categoryTotal: number;
  products: Product[];
}> = ({ subcategory, color, subPercent, categoryTotal, products }) => (
  <>
    <tr className="bg-sabbi-neutral-50/80">
      <td className="px-4 py-1.5 pl-10">
        <span className="text-xs font-medium text-sabbi-neutral-700">
          {subcategory}
        </span>
      </td>
      <td className="px-4 py-1.5 text-right text-xs font-medium text-sabbi-neutral-700">
        {subPercent.toFixed(1)}%
      </td>
      <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-400">—</td>
      <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-400">—</td>
    </tr>
    {products.map((product) => {
      const productPercent =
        categoryTotal > 0 ? (product.amount / categoryTotal) * 100 : 0;
      return (
        <tr key={product.id}>
          <td className="px-4 py-1.5 pl-14">
            <div className="flex flex-col gap-1">
              <span className="truncate text-xs text-sabbi-neutral-600">
                {product.name}
              </span>
              <div className="h-1 w-32 overflow-hidden rounded-full bg-sabbi-neutral-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${productPercent}%`, backgroundColor: color }}
                />
              </div>
            </div>
          </td>
          <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-600">
            {productPercent.toFixed(1)}%
          </td>
          <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-400">—</td>
          <td className="px-4 py-1.5 text-right text-xs text-sabbi-neutral-400">—</td>
        </tr>
      );
    })}
  </>
);
