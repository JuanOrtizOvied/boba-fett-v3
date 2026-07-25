import type { FC } from "react";
import { AddProductButton } from "@/components/portfolio/AddProductButton";
import { ProductCard } from "@/components/portfolio/ProductCard";
import { ASSET_CLASS_META, assetClassColorVar } from "@/lib/categories";
import { formatUsd } from "@/lib/format";
import type { AssetClass, Product } from "@/lib/portfolio-types";

export interface AssetClassSectionProps {
  assetClass: AssetClass;
  index: number;
  products: Product[];
  newProductIds: Set<string>;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => Promise<void>;
  onAddProduct: (assetClass: AssetClass) => void;
}

/**
 * One asset class's header (numbered badge + title + total) and its cards
 * grid, ending with the "Agregar producto" button.
 * `portfolio-dashboard.spec.md` → "Secciones por clase de activo con header y total".
 */
export const AssetClassSection: FC<AssetClassSectionProps> = ({
  assetClass,
  index,
  products,
  newProductIds,
  onEditProduct,
  onDeleteProduct,
  onAddProduct,
}) => {
  const meta = ASSET_CLASS_META[assetClass];
  const total = products.reduce((sum, p) => sum + p.amount, 0);
  const color = assetClassColorVar(assetClass);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="flex size-6 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            {index + 1}
          </span>
          <h3 className="text-sm font-semibold text-sabbi-neutral-900">{meta.label}</h3>
        </div>
        <span className="text-sm font-semibold text-sabbi-neutral-900">
          {formatUsd(total)}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            isNew={newProductIds.has(product.id)}
            onEdit={onEditProduct}
            onDelete={onDeleteProduct}
          />
        ))}
        <AddProductButton onClick={() => onAddProduct(assetClass)} />
      </div>
    </section>
  );
};
