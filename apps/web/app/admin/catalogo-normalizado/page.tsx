"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { EditIcon, TrashIcon } from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/components/ui/Toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import { CatalogSearch } from "@/components/admin/catalog/CatalogSearch";
import ProductFormModal from "@/components/admin/catalog-normalized/ProductFormModal";
import SeriesFormModal from "@/components/admin/catalog-normalized/SeriesFormModal";
import AdminFormModal from "@/components/admin/catalog-normalized/AdminFormModal";
import {
  ConfirmDeleteDialog,
  formatFraction,
  formatUsd,
  readApiError,
} from "@/components/admin/catalog-normalized/shared";
import type { AssetAllocation } from "@/lib/portfolio-types";
import type {
  CatalogObservation,
  CatalogProductRow,
  CatalogProductSeries,
  CatalogProductSeriesAdmin,
  ProductObservations,
} from "@/lib/normalized-catalog-types";
import {
  indexObservations,
  observationCountLabel,
  observationMessages,
  type ObservationScope,
} from "@/lib/normalizedCatalogObservations";

const BASE = "/api/admin/normalized-catalog";

type ModalState =
  | { kind: "product"; product: CatalogProductRow | null }
  | { kind: "series"; series: CatalogProductSeries | null }
  | { kind: "admin"; seriesLabel: string; admin: CatalogProductSeriesAdmin | null }
  | null;

type DeleteTarget =
  | { kind: "product"; code: string; name: string }
  | { kind: "series"; id: number; label: string }
  | { kind: "admin"; id: number; label: string }
  | null;

export default function NormalizedCatalogPage() {
  // useUrlSearch → useSearchParams requires a <Suspense> boundary in App Router.
  return (
    <Suspense
      fallback={<p className="text-sm text-sabbi-neutral-600">Cargando…</p>}
    >
      <NormalizedCatalogContent />
    </Suspense>
  );
}

function NormalizedCatalogContent() {
  const { toast } = useToast();
  const [products, setProducts] = useState<CatalogProductRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<CatalogProductRow | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [searchInput, setSearchInput] = useUrlSearch("search");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [isFetching, setIsFetching] = useState(false);
  const listAbortRef = useRef<AbortController | null>(null);

  const isDebouncing =
    searchInput.trim() !== debouncedSearch.trim() && searchInput.trim() !== "";

  const loadList = useCallback(
    async (term: string, signal?: AbortSignal) => {
      const qs = term ? `?${new URLSearchParams({ search: term })}` : "";
      const res = await fetchWithAuth(`${BASE}/products${qs}`, { signal });
      if (!res.ok) {
        throw new Error(
          await readApiError(res, "No se pudo cargar el catálogo normalizado"),
        );
      }
      setProducts(await res.json());
    },
    [],
  );

  useEffect(() => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setListError(null);
    setIsFetching(true);
    loadList(debouncedSearch.trim(), controller.signal)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setListError(err instanceof Error ? err.message : "Error desconocido");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFetching(false);
      });
    return () => controller.abort();
  }, [debouncedSearch, loadList]);

  const refetchList = useCallback(
    () => loadList(debouncedSearch.trim()),
    [loadList, debouncedSearch],
  );

  const loadDetail = useCallback(
    async (code: string, signal?: AbortSignal) => {
      const res = await fetchWithAuth(
        `${BASE}/products/${encodeURIComponent(code)}`,
        { signal },
      );
      if (!res.ok) {
        throw new Error(await readApiError(res, "No se pudo cargar el producto"));
      }
      setDetail(await res.json());
    },
    [],
  );

  useEffect(() => {
    if (!selectedCode) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailError(null);
    loadDetail(selectedCode, controller.signal).catch((err: unknown) => {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!controller.signal.aborted) {
        setDetail(null);
        setDetailError(err instanceof Error ? err.message : "Error desconocido");
      }
    });
    return () => controller.abort();
  }, [selectedCode, loadDetail]);

  // Observations cover the whole catalog, so they do not depend on the search
  // term or the selected product. A failed load simply shows none.
  const [observations, setObservations] = useState<
    Map<string, CatalogObservation[]>
  >(new Map());

  const loadObservations = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${BASE}/observations`);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (Array.isArray(data)) {
        setObservations(indexObservations(data as ProductObservations[]));
      }
    } catch {
      // Observations are a hint; the catalog still works without them.
    }
  }, []);

  useEffect(() => {
    void loadObservations();
  }, [loadObservations]);

  const refetchDetail = useCallback(async () => {
    if (selectedCode) await loadDetail(selectedCode);
    await loadObservations();
  }, [selectedCode, loadDetail, loadObservations]);

  const handleProductSaved = async (code: string) => {
    await refetchList();
    if (code === selectedCode) await refetchDetail();
    else {
      setSelectedCode(code);
      await loadObservations();
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const path =
        deleteTarget.kind === "product"
          ? `products/${encodeURIComponent(deleteTarget.code)}`
          : deleteTarget.kind === "series"
            ? `series/${deleteTarget.id}`
            : `admins/${deleteTarget.id}`;
      const res = await fetchWithAuth(`${BASE}/${path}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await readApiError(res, "No se pudo eliminar"));
      }
      if (deleteTarget.kind === "product") {
        setSelectedCode(null);
        await refetchList();
        await loadObservations();
        toast("Producto eliminado.", "success");
      } else {
        await refetchDetail();
        toast(
          deleteTarget.kind === "series" ? "Serie eliminada." : "Administrador eliminado.",
          "success",
        );
      }
      setDeleteTarget(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido");
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteCopy = (t: NonNullable<DeleteTarget>) => {
    if (t.kind === "product") {
      return {
        title: "Eliminar producto",
        message: `Se eliminará "${t.name}" junto con todas sus series y administradores. Esta acción no se puede deshacer.`,
      };
    }
    if (t.kind === "series") {
      return {
        title: "Eliminar serie",
        message: `Se eliminará la serie "${t.label}" y sus administradores. Esta acción no se puede deshacer.`,
      };
    }
    return {
      title: "Eliminar administrador",
      message: `Se eliminará el administrador "${t.label}". Esta acción no se puede deshacer.`,
    };
  };

  const isSearchMode = debouncedSearch.trim() !== "";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">
        Catálogo normalizado
      </h1>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {/* -- Master: product list ------------------------------------ */}
        <section className="flex flex-col gap-3">
          <CatalogSearch
            value={searchInput}
            onChange={setSearchInput}
            isLoading={isFetching || isDebouncing}
          />
          <button
            type="button"
            onClick={() => setModal({ kind: "product", product: null })}
            className="w-fit rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sabbi-primary-hover"
          >
            + Nuevo producto
          </button>

          {listError && <p className="text-sm text-red-600">{listError}</p>}

          {products === null && !listError ? (
            <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
          ) : products && products.length === 0 ? (
            <p className="text-sm text-sabbi-neutral-600">
              {isSearchMode
                ? "No se encontraron productos."
                : "No hay productos en el catálogo normalizado."}
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-sabbi-neutral-200 overflow-auto rounded-xl border border-sabbi-neutral-200 bg-white">
              {(products ?? []).map((p) => {
                const active = p.code === selectedCode;
                const observationCount = observations.get(p.code)?.length ?? 0;
                return (
                  <li key={p.code}>
                    <button
                      type="button"
                      onClick={() => setSelectedCode(p.code)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-[#f0fcd4] ${
                        active ? "bg-[#f0fcd4]" : ""
                      }`}
                    >
                      <span className="text-sm font-medium text-sabbi-neutral-900">
                        {p.name}
                        {observationCount > 0 && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-amber-800 uppercase">
                            {observationCountLabel(observationCount)}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-sabbi-neutral-500">{p.code}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* -- Detail --------------------------------------------------- */}
        <section className="min-w-0">
          {detailError && <p className="text-sm text-red-600">{detailError}</p>}
          {!selectedCode ? (
            <p className="text-sm text-sabbi-neutral-600">
              Selecciona un producto para ver su detalle.
            </p>
          ) : !detail ? (
            !detailError && (
              <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
            )
          ) : (
            <ProductDetail
              product={detail}
              observations={observations.get(detail.code) ?? []}
              onEditProduct={() => setModal({ kind: "product", product: detail })}
              onDeleteProduct={() =>
                setDeleteTarget({ kind: "product", code: detail.code, name: detail.name })
              }
              onAddSeries={() => setModal({ kind: "series", series: null })}
              onEditSeries={(s) => setModal({ kind: "series", series: s })}
              onDeleteSeries={(s) =>
                setDeleteTarget({ kind: "series", id: s.id, label: s.series })
              }
              onAddAdmin={(s) =>
                setModal({ kind: "admin", seriesLabel: s.series, admin: null })
              }
              onEditAdmin={(s, a) =>
                setModal({ kind: "admin", seriesLabel: s.series, admin: a })
              }
              onDeleteAdmin={(a) =>
                setDeleteTarget({ kind: "admin", id: a.id, label: a.administrator })
              }
            />
          )}
        </section>
      </div>

      {modal?.kind === "product" && (
        <ProductFormModal
          product={modal.product}
          onClose={() => setModal(null)}
          onSaved={handleProductSaved}
        />
      )}
      {modal?.kind === "series" && detail && (
        <SeriesFormModal
          productCode={detail.code}
          series={modal.series}
          onClose={() => setModal(null)}
          onSaved={refetchDetail}
        />
      )}
      {modal?.kind === "admin" && detail && (
        <AdminFormModal
          productCode={detail.code}
          seriesLabel={modal.seriesLabel}
          admin={modal.admin}
          onClose={() => setModal(null)}
          onSaved={refetchDetail}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          {...deleteCopy(deleteTarget)}
          isDeleting={isDeleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
    </div>
  );
}

// -- Read-only detail views ---------------------------------------------------

function formatAllocations(rows: AssetAllocation[]): string {
  return rows.length === 0
    ? "—"
    : rows.map((r) => `${r.name} ${r.percentage}%`).join(", ");
}

/** One read-only field. `issues` are the observations of this field: it turns
 * amber and each one is written under the value, where the data is. */
function Attr({
  label,
  value,
  issues = [],
}: {
  label: string;
  value: string;
  issues?: string[];
}) {
  const flagged = issues.length > 0;
  return (
    <div
      className={`flex flex-col gap-0.5 ${
        flagged ? "rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5" : ""
      }`}
    >
      <dt
        className={`text-xs font-medium ${
          flagged ? "text-amber-800" : "text-sabbi-neutral-500"
        }`}
      >
        {label}
      </dt>
      <dd className="text-sm text-sabbi-neutral-900">{value || "—"}</dd>
      {issues.map((issue) => (
        <dd key={issue} className="text-xs font-medium text-amber-800">
          {issue}
        </dd>
      ))}
    </div>
  );
}

/** Amber replacement for the "nothing here yet" line of an empty list. */
function EmptyNote({ children, issues }: { children: string; issues: string[] }) {
  return (
    <p
      className={`text-sm ${
        issues.length > 0 ? "font-medium text-amber-800" : "text-sabbi-neutral-600"
      }`}
    >
      {children}
    </p>
  );
}

function IconButton({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`rounded-md p-1.5 text-sabbi-neutral-500 transition-colors ${
        danger
          ? "hover:bg-red-50 hover:text-red-600"
          : "hover:bg-sabbi-neutral-100 hover:text-sabbi-neutral-900"
      }`}
    >
      {children}
    </button>
  );
}

const linkButtonClass =
  "w-fit rounded-md px-2 py-1 text-xs font-medium text-sabbi-primary hover:bg-sabbi-neutral-50";

function ProductDetail({
  product,
  observations,
  onEditProduct,
  onDeleteProduct,
  onAddSeries,
  onEditSeries,
  onDeleteSeries,
  onAddAdmin,
  onEditAdmin,
  onDeleteAdmin,
}: {
  product: CatalogProductRow;
  observations: CatalogObservation[];
  onEditProduct: () => void;
  onDeleteProduct: () => void;
  onAddSeries: () => void;
  onEditSeries: (s: CatalogProductSeries) => void;
  onDeleteSeries: (s: CatalogProductSeries) => void;
  onAddAdmin: (s: CatalogProductSeries) => void;
  onEditAdmin: (s: CatalogProductSeries, a: CatalogProductSeriesAdmin) => void;
  onDeleteAdmin: (a: CatalogProductSeriesAdmin) => void;
}) {
  const issuesOf = (scope: ObservationScope, field: string) =>
    observationMessages(observations, scope, field);
  const productIssues = (field: string) => issuesOf({ level: "product" }, field);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-sabbi-neutral-200 bg-white p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-sabbi-neutral-900">
              {product.name}
            </h2>
            <p className="text-xs text-sabbi-neutral-500">Código: {product.code}</p>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onEditProduct}
              className="flex items-center gap-1.5 rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
            >
              <EditIcon size={14} />
              Editar
            </button>
            <button
              type="button"
              onClick={onDeleteProduct}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <TrashIcon size={14} />
              Eliminar producto
            </button>
          </div>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Attr label="Ticker / ISIN" value={product.ticker_isin} />
          <Attr label="Gestor" value={product.manager} issues={productIssues("manager")} />
          <Attr label="Moneda" value={product.currency} issues={productIssues("currency")} />
          <Attr
            label="Horizonte de inversión"
            value={product.investment_horizon}
            issues={productIssues("investment_horizon")}
          />
          <Attr
            label="Clase de activo"
            value={formatAllocations(product.asset_class)}
            issues={productIssues("asset_class")}
          />
          <Attr
            label="Foco geográfico"
            value={formatAllocations(product.geographic_focus)}
            issues={productIssues("geographic_focus")}
          />
          <Attr
            label="Subyacente"
            value={formatAllocations(product.underlying)}
            issues={productIssues("underlying")}
          />
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-sabbi-neutral-900">Series</h3>
          <button
            type="button"
            onClick={onAddSeries}
            className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover"
          >
            + Serie
          </button>
        </div>

        {product.series.length === 0 && (
          <EmptyNote issues={productIssues("series")}>
            Este producto aún no tiene series.
          </EmptyNote>
        )}

        {product.series.map((s) => {
          const seriesIssues = (field: string) =>
            issuesOf({ level: "series", series: s.series }, field);
          return (
          <div
            key={s.id}
            className="rounded-xl border border-sabbi-neutral-200 bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-sabbi-neutral-900">
                {s.series}
              </h4>
              <div className="flex gap-1">
                <IconButton title={`Editar serie ${s.series}`} onClick={() => onEditSeries(s)}>
                  <EditIcon size={16} />
                </IconButton>
                <IconButton
                  title={`Eliminar serie ${s.series}`}
                  danger
                  onClick={() => onDeleteSeries(s)}
                >
                  <TrashIcon size={16} />
                </IconButton>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Attr
                label="Comisión de gestión (TER)"
                value={formatFraction(s.management_fee_ter)}
                issues={seriesIssues("management_fee_ter")}
              />
              <Attr
                label="Flujos mínimo"
                value={formatFraction(s.flows_min)}
                issues={seriesIssues("flows_min")}
              />
              <Attr
                label="Flujos máximo"
                value={formatFraction(s.flows_max)}
                issues={seriesIssues("flows_max")}
              />
              <Attr
                label="Rentabilidad mínima"
                value={formatFraction(s.return_min)}
                issues={seriesIssues("return_min")}
              />
              <Attr
                label="Rentabilidad máxima"
                value={formatFraction(s.return_max)}
                issues={seriesIssues("return_max")}
              />
            </dl>

            <div className="mt-4 border-t border-sabbi-neutral-200 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <h5 className="text-xs font-semibold tracking-wide text-sabbi-neutral-600 uppercase">
                  Administradores
                </h5>
                <button type="button" onClick={() => onAddAdmin(s)} className={linkButtonClass}>
                  + Administrador
                </button>
              </div>
              {s.administrators.length === 0 && (
                <EmptyNote issues={seriesIssues("administrators")}>
                  Sin administradores en esta serie.
                </EmptyNote>
              )}
              <ul className="flex flex-col gap-2">
                {s.administrators.map((a) => {
                  const adminIssues = (field: string) =>
                    issuesOf(
                      { level: "admin", series: s.series, administrator: a.administrator },
                      field,
                    );
                  return (
                  <li
                    key={a.id}
                    className="rounded-lg border border-sabbi-neutral-200 bg-sabbi-neutral-50 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-sabbi-neutral-900">
                        {a.administrator}
                      </span>
                      <div className="flex gap-1">
                        <IconButton
                          title={`Editar administrador ${a.administrator}`}
                          onClick={() => onEditAdmin(s, a)}
                        >
                          <EditIcon size={16} />
                        </IconButton>
                        <IconButton
                          title={`Eliminar administrador ${a.administrator}`}
                          danger
                          onClick={() => onDeleteAdmin(a)}
                        >
                          <TrashIcon size={16} />
                        </IconButton>
                      </div>
                    </div>
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <Attr
                        label="Comisión de custodia"
                        value={formatFraction(a.custody_fee)}
                        issues={adminIssues("custody_fee")}
                      />
                      <Attr
                        label="Comisión de compra"
                        value={formatFraction(a.buy_commission)}
                        issues={adminIssues("buy_commission")}
                      />
                      <Attr
                        label="Comisión de venta"
                        value={formatFraction(a.sell_commission)}
                        issues={adminIssues("sell_commission")}
                      />
                      <Attr
                        label="Moneda de facturación"
                        value={a.billing_currency}
                        issues={adminIssues("billing_currency")}
                      />
                      <Attr
                        label="Mínimo (USD)"
                        value={formatUsd(a.minimum_usd)}
                        issues={adminIssues("minimum_usd")}
                      />
                      <Attr
                        label="Comisión mínima (USD)"
                        value={formatUsd(a.min_commission_usd)}
                        issues={adminIssues("min_commission_usd")}
                      />
                    </dl>
                  </li>
                  );
                })}
              </ul>
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}
