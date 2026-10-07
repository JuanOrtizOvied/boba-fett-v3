"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CatalogSearch } from "@/components/admin/catalog/CatalogSearch";
import {
  CatalogV2Filters,
  EMPTY_CATALOG_V2_FILTERS,
  type CatalogV2FilterState,
} from "@/components/admin/catalog-v2/CatalogV2Filters";
import { CatalogV2ObservationsBanner } from "@/components/admin/catalog-v2/CatalogV2ObservationsBanner";
import { CatalogV2Table } from "@/components/admin/catalog-v2/CatalogV2Table";
import { useToast } from "@/components/ui/Toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import {
  countV2ProductsWithObservations,
  getV2Observations,
  summarizeV2Observations,
} from "@/lib/catalogV2Observations";
import type {
  CatalogV2Options,
  CatalogV2Product,
  V2Administrator,
  V2Manager,
} from "@/lib/catalogV2Types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

/**
 * Catalog v2 admin page (`openspec/changes/catalog-v2-sharepoint-sync`). It
 * lives in its own folder so v2 can be removed without touching the v1 catalog
 * page. The workbook owns every product, series and link, so the page is
 * read-only apart from restoring a deleted product.
 */

// The backend caps a page at 1000 and the catalog is far below it, so the
// table asks for everything, as the v1 page does.
const PAGE_SIZE = 1000;
const API = "/api/admin/catalog-v2";

export default function CatalogV2Page() {
  // useUrlSearch → useSearchParams requires a <Suspense> boundary in App Router.
  return (
    <Suspense fallback={<p className="text-sm text-sabbi-neutral-600">Cargando…</p>}>
      <CatalogV2PageContent />
    </Suspense>
  );
}

function listUrl(params: URLSearchParams): string {
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", "0");
  return `${API}/entries?${params}`;
}

function CatalogV2PageContent() {
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useUrlSearch("search");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const isDebouncing = searchInput.trim() !== debouncedSearch.trim() && searchInput.trim() !== "";
  const [filters, setFilters] = useState<CatalogV2FilterState>(EMPTY_CATALOG_V2_FILTERS);
  const [showDeleted, setShowDeleted] = useState(false);
  const [observationsOnly, setObservationsOnly] = useState(false);

  const [products, setProducts] = useState<CatalogV2Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The whole active catalog, independent of search and filters: the
  // Observaciones banner counts over this, never over `products`.
  const [allProducts, setAllProducts] = useState<CatalogV2Product[] | null>(null);
  const [allProductsFailed, setAllProductsFailed] = useState(false);
  const allProductsRequestRef = useRef(0);

  const [options, setOptions] = useState<CatalogV2Options | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [managers, setManagers] = useState<V2Manager[]>([]);
  const [administrators, setAdministrators] = useState<V2Administrator[]>([]);

  const loadProducts = useCallback(
    async (signal: AbortSignal) => {
      const params = new URLSearchParams();
      const term = debouncedSearch.trim();
      if (term) params.set("search", term);
      if (showDeleted) params.set("include_deleted", "true");
      for (const id of filters.managerIds) params.append("manager_id", String(id));
      for (const id of filters.administratorIds) params.append("administrator_id", String(id));

      const res = await fetchWithAuth(listUrl(params), { signal });
      if (!res.ok) throw new Error(`No se pudo cargar el catálogo (status ${res.status})`);
      setProducts(await res.json());
    },
    [debouncedSearch, filters, showDeleted],
  );

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setIsFetching(true);
    loadProducts(controller.signal)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Error desconocido");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFetching(false);
      });
    return () => controller.abort();
  }, [loadProducts]);

  const loadAllProducts = useCallback(async () => {
    const requestId = ++allProductsRequestRef.current;
    try {
      const res = await fetchWithAuth(listUrl(new URLSearchParams()));
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data: unknown = await res.json();
      // A newer request supersedes this one (e.g. two quick restores).
      if (requestId !== allProductsRequestRef.current) return;
      if (!Array.isArray(data)) throw new Error("unexpected response");
      setAllProducts(data as CatalogV2Product[]);
      setAllProductsFailed(false);
    } catch {
      if (requestId === allProductsRequestRef.current) setAllProductsFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadAllProducts();
  }, [loadAllProducts]);

  // The official lists and the entities, which the banner and the filters need.
  useEffect(() => {
    (async () => {
      try {
        const [optionsRes, managersRes, administratorsRes] = await Promise.all([
          fetchWithAuth(`${API}/options`),
          fetchWithAuth(`${API}/managers`),
          fetchWithAuth(`${API}/administrators`),
        ]);
        if (optionsRes.ok) setOptions(await optionsRes.json());
        else setOptionsFailed(true);
        if (managersRes.ok) setManagers(await managersRes.json());
        if (administratorsRes.ok) setAdministrators(await administratorsRes.json());
      } catch {
        // The filters just stay empty; without the official lists the table
        // cannot judge the observations, so it says so.
        setOptionsFailed(true);
      }
    })();
  }, []);

  const observationSummary = useMemo(() => {
    if (!allProducts || !options) return null;
    return {
      groups: summarizeV2Observations(allProducts, options),
      productsWithObservations: countV2ProductsWithObservations(allProducts, options),
    };
  }, [allProducts, options]);

  // Observaciones combines by AND with the search, the filters and the deleted
  // toggle, and it only ever keeps active products.
  const visibleProducts = useMemo(() => {
    if (!products) return null;
    if (!observationsOnly) return products;
    if (!options) return [];
    return products.filter(
      (product) => !product.is_deleted && getV2Observations(product, options).length > 0,
    );
  }, [products, observationsOnly, options]);

  // Both lists: a row can change state and the banner count can change.
  const reloadLists = useCallback(
    () => Promise.all([loadProducts(new AbortController().signal), loadAllProducts()]),
    [loadProducts, loadAllProducts],
  );

  const handleRestore = async (id: number) => {
    setRestoringId(id);
    try {
      const res = await fetchWithAuth(`${API}/entries/${id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error(`No se pudo restaurar el producto (status ${res.status})`);
      await reloadLists();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">Catálogo v2</h1>
        <div className="w-full sm:w-80">
          <CatalogSearch
            value={searchInput}
            onChange={setSearchInput}
            isLoading={isFetching || isDebouncing}
          />
        </div>
      </div>

      <CatalogV2ObservationsBanner
        groups={observationSummary?.groups ?? null}
        productsWithObservations={observationSummary?.productsWithObservations ?? 0}
        failed={allProductsFailed}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <CatalogV2Filters
          value={filters}
          onChange={setFilters}
          managers={managers}
          administrators={administrators}
        />
        <div className="flex items-center gap-4 pb-1.5">
          <label className="flex items-center gap-1.5 text-sm text-sabbi-neutral-700 select-none">
            <input
              type="checkbox"
              checked={observationsOnly}
              onChange={(e) => setObservationsOnly(e.target.checked)}
              className="size-4 rounded border-sabbi-neutral-300"
            />
            Observaciones
          </label>
          <label className="flex items-center gap-1.5 text-sm text-sabbi-neutral-700 select-none">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
              className="size-4 rounded border-sabbi-neutral-300"
            />
            Ver eliminados
          </label>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {optionsFailed && (
        <p className="text-sm text-red-600">No se pudieron cargar las listas oficiales.</p>
      )}

      {(visibleProducts === null || !options) && !error && !optionsFailed ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : !visibleProducts || !options ? null : visibleProducts.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">
          {observationsOnly
            ? "Ningún producto tiene observaciones con los filtros actuales."
            : "No se encontraron productos."}
        </p>
      ) : (
        <CatalogV2Table
          products={visibleProducts}
          options={options}
          restoringId={restoringId}
          onRestore={(id) => void handleRestore(id)}
          onScoreChange={() => void reloadLists()}
        />
      )}
    </div>
  );
}
