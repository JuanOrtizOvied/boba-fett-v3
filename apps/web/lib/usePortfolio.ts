"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getPortfolioId } from "@/lib/portfolioId";
import type { Category, Product } from "@/lib/portfolio-types";

export type CategoryFilter = Category | "todos";

export interface LargestPosition {
  product: Product;
  percentage: number;
}

/** Poll interval for picking up agent-created products (T-500 wires the
 * proper post-chat-turn refetch; this covers the gap until then). */
const REFETCH_POLL_MS = 5000;

export interface UsePortfolioResult {
  portfolioId: string;
  products: Product[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;

  activeCategory: CategoryFilter;
  setActiveCategory: (category: CategoryFilter) => void;

  editingProduct: Product | null;
  isModalOpen: boolean;
  createCategory: Category | null;
  openCreateModal: (category?: Category) => void;
  openEditModal: (product: Product) => void;
  closeModal: () => void;

  totalAmount: number;
  productCount: number;
  categoryDistribution: Record<Category, number>;
  largestPosition: LargestPosition | null;
}

/**
 * Portfolio data lives in PostgreSQL (design.md → "State Management").
 * This hook fetches it via the REST API and layers local UI state
 * (active filter, modal open/editing target) plus derived metrics on top.
 * No zustand — the tasks.md T-301 mention of zustand is stale; the store of
 * truth is the backend, not client state.
 */
export function usePortfolio(): UsePortfolioResult {
  const portfolioId = useMemo(() => getPortfolioId(), []);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("todos");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createCategory, setCreateCategory] = useState<Category | null>(null);

  const refetch = useCallback(async () => {
    if (!portfolioId) return;
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/${portfolioId}`);
      if (!res.ok) throw new Error(`Failed to load portfolio (${res.status})`);
      const data: { products: Product[] } = await res.json();
      setProducts(data.products ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [portfolioId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refetch();
    }, REFETCH_POLL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  const openCreateModal = useCallback((category?: Category) => {
    setEditingProduct(null);
    setCreateCategory(category ?? null);
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback((product: Product) => {
    setEditingProduct(product);
    setCreateCategory(null);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingProduct(null);
    setCreateCategory(null);
  }, []);

  const totalAmount = useMemo(
    () => products.reduce((sum, p) => sum + p.amount, 0),
    [products],
  );

  const productCount = products.length;

  const categoryDistribution = useMemo(() => {
    const dist = {} as Record<Category, number>;
    for (const p of products) {
      dist[p.category] = (dist[p.category] ?? 0) + p.amount;
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
    portfolioId,
    products,
    isLoading,
    error,
    refetch,
    activeCategory,
    setActiveCategory,
    editingProduct,
    isModalOpen,
    createCategory,
    openCreateModal,
    openEditModal,
    closeModal,
    totalAmount,
    productCount,
    categoryDistribution,
    largestPosition,
  };
}
