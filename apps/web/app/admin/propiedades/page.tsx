"use client";

import { Suspense, useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/components/ui/Toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import { PropertyDetail } from "@/components/admin/properties/PropertyDetail";
import { PropertyList } from "@/components/admin/properties/PropertyList";
import { PropertySearch } from "@/components/admin/properties/PropertySearch";
import {
  parsePropertyDetail,
  parsePropertyList,
  readError,
  type PropertyDetail as PropertyDetailData,
  type PropertySummary,
} from "@/lib/properties";

const BASE = "/api/admin/properties";
const LIST_ERROR = "No se pudieron cargar las propiedades";
const DETAIL_ERROR = "No se pudo cargar la propiedad";

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export default function PropertiesPage() {
  // useUrlSearch -> useSearchParams requires a <Suspense> boundary in App Router.
  return (
    <Suspense fallback={<p className="text-sm text-sabbi-neutral-600">Cargando…</p>}>
      <PropertiesContent />
    </Suspense>
  );
}

function PropertiesContent() {
  const [properties, setProperties] = useState<PropertySummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<PropertyDetailData | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const { toast } = useToast();

  const [searchInput, setSearchInput] = useUrlSearch("search");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const term = debouncedSearch.trim();
  const isDebouncing = searchInput.trim() !== term && searchInput.trim() !== "";

  useEffect(() => {
    const controller = new AbortController();
    setListError(null);
    setIsFetching(true);
    (async () => {
      const qs = term ? `?${new URLSearchParams({ search: term })}` : "";
      const res = await fetchWithAuth(`${BASE}${qs}`, { signal: controller.signal });
      if (!res.ok) throw new Error(await readError(res, LIST_ERROR));
      const parsed = parsePropertyList(await res.json());
      if (!parsed) throw new Error(LIST_ERROR);
      if (!controller.signal.aborted) setProperties(parsed);
    })()
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbort(err)) return;
        setProperties(null);
        setListError(err instanceof Error ? err.message : LIST_ERROR);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFetching(false);
      });
    return () => controller.abort();
  }, [term, reloadKey]);

  useEffect(() => {
    if (!selectedCode) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    (async () => {
      const res = await fetchWithAuth(`${BASE}/${encodeURIComponent(selectedCode)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await readError(res, DETAIL_ERROR));
      const parsed = parsePropertyDetail(await res.json());
      if (!parsed) throw new Error(DETAIL_ERROR);
      if (!controller.signal.aborted) setDetail(parsed);
    })().catch((err: unknown) => {
      if (controller.signal.aborted || isAbort(err)) return;
      setDetailError(err instanceof Error ? err.message : DETAIL_ERROR);
    });
    return () => controller.abort();
  }, [selectedCode]);

  const handleBackfillSlugs = async () => {
    setIsBackfilling(true);
    try {
      const res = await fetchWithAuth(`${BASE}/backfill-slugs`, { method: "POST" });
      if (!res.ok) {
        throw new Error(await readError(res, "No se pudieron generar los slugs"));
      }
      const data: { updated: Record<string, number>; total: number } = await res.json();
      if (data.total > 0) {
        const detail = Object.entries(data.updated)
          .filter(([, n]) => n > 0)
          .map(([field, n]) => `${field}: ${n}`)
          .join(", ");
        toast(`Slugs generados: ${data.total} fila(s) actualizada(s) (${detail})`, "success");
        setReloadKey((k) => k + 1);
      } else {
        toast("No faltaban slugs", "success");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsBackfilling(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Propiedades</h1>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {/* -- Master: property list ----------------------------------- */}
        <section className="flex flex-col gap-3">
          <PropertySearch
            value={searchInput}
            onChange={setSearchInput}
            isLoading={isFetching || isDebouncing}
          />
          <button
            type="button"
            onClick={handleBackfillSlugs}
            disabled={isBackfilling}
            className="w-fit rounded-lg border border-sabbi-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-sabbi-neutral-900 transition-colors hover:bg-sabbi-neutral-100 disabled:opacity-50"
          >
            {isBackfilling ? "Generando slugs…" : "Generar slugs faltantes"}
          </button>
          <PropertyList
            properties={properties}
            error={listError}
            selectedCode={selectedCode}
            searching={term !== ""}
            onSelect={setSelectedCode}
          />
        </section>

        {/* -- Detail --------------------------------------------------- */}
        <section className="min-w-0">
          {detailError ? (
            <p role="alert" className="text-sm text-red-600">
              {detailError}
            </p>
          ) : !selectedCode ? (
            <p className="text-sm text-sabbi-neutral-600">
              Selecciona una propiedad para ver su detalle.
            </p>
          ) : !detail ? (
            <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
          ) : (
            <PropertyDetail property={detail} />
          )}
        </section>
      </div>
    </div>
  );
}
