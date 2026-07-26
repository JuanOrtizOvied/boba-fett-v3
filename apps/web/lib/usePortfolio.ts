"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { PORTFOLIO_REFETCH_EVENT } from "@/lib/portfolioEvents";
import { resolveAssetClassKey } from "@/lib/categories";
import type { AssetClass, Product } from "@/lib/portfolio-types";

export type AssetClassFilter = AssetClass | "todos";

export interface LargestPosition {
  product: Product;
  percentage: number;
}

const NEW_PRODUCT_HIGHLIGHT_MS = 3000;

export interface UsePortfolioResult {
  products: Product[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;

  activeAssetClass: AssetClassFilter;
  setActiveAssetClass: (assetClass: AssetClassFilter) => void;

  editingProduct: Product | null;
  isModalOpen: boolean;
  createAssetClass: AssetClass | null;
  openCreateModal: (assetClass?: AssetClass) => void;
  openEditModal: (product: Product) => void;
  closeModal: () => void;

  totalAmount: number;
  productCount: number;
  assetClassDistribution: Record<AssetClass, number>;
  largestPosition: LargestPosition | null;

  newProductIds: Set<string>;
}

/**
 * Portfolio data lives in PostgreSQL (design.md → "State Management").
 * This hook fetches it via the REST API and layers local UI state
 * (active filter, modal open/editing target) plus derived metrics on top.
 * No zustand — the tasks.md T-301 mention of zustand is stale; the store of
 * truth is the backend, not client state.
 */
export function usePortfolio(): UsePortfolioResult {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeAssetClass, setActiveAssetClass] = useState<AssetClassFilter>("todos");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createAssetClass, setCreateAssetClass] = useState<AssetClass | null>(null);

  const isFirstFetchRef = useRef(true);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [newProductIds, setNewProductIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(products.map((p) => p.id));

    if (isFirstFetchRef.current) {
      isFirstFetchRef.current = false;
      prevIdsRef.current = currentIds;
      return;
    }

    const added = new Set<string>();
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) added.add(id);
    }
    prevIdsRef.current = currentIds;

    if (added.size > 0) {
      setNewProductIds(added);
      const timer = setTimeout(
        () => setNewProductIds(new Set()),
        NEW_PRODUCT_HIGHLIGHT_MS,
      );
      return () => clearTimeout(timer);
    }
  }, [products]);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchWithAuth("/api/portfolio/me");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(`Failed to load portfolio (${res.status})`);
      const data: { products: Product[] } = await res.json();
      setProducts(data.products ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const handleRefetchEvent = () => {
      void refetch();
    };
    window.addEventListener(PORTFOLIO_REFETCH_EVENT, handleRefetchEvent);
    return () =>
      window.removeEventListener(PORTFOLIO_REFETCH_EVENT, handleRefetchEvent);
  }, [refetch]);

  const openCreateModal = useCallback((assetClass?: AssetClass) => {
    setEditingProduct(null);
    setCreateAssetClass(assetClass ?? null);
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback((product: Product) => {
    setEditingProduct(product);
    setCreateAssetClass(null);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setCreateAssetClass(null);
  }, []);

  const totalAmount = useMemo(
    () => products.reduce((sum, p) => sum + p.amount, 0),
    [products],
  );

  const productCount = products.length;

  const assetClassDistribution = useMemo(() => {
    const dist = {} as Record<AssetClass, number>;
    for (const p of products) {
      for (const alloc of p.asset_class ?? []) {
        const key = resolveAssetClassKey(alloc.name) as AssetClass;
        dist[key] = (dist[key] ?? 0) + (p.amount * alloc.percentage) / 100;
      }
    }
    return dist;
  }, [products]);

  const largestPosition = useMemo<LargestPosition | null>(() => {
    if (products.length === 0 || totalAmount === 0) return null;
    const largest = products.reduce(
      (max, p) => (p.amount > max.amount ? p : max),
      products[0],
    );
    return { product: largest, percentage: (largest.amount / totalAmount) * 100 };
  }, [products, totalAmount]);

  return {
    products,
    isLoading,
    error,
    refetch,
    activeAssetClass,
    setActiveAssetClass,
    editingProduct,
    isModalOpen,
    createAssetClass,
    openCreateModal,
    openEditModal,
    closeModal,
    totalAmount,
    productCount,
    assetClassDistribution,
    largestPosition,
    newProductIds,
  };
}
