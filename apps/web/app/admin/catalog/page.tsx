"use client";

import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DownloadIcon,
  EditIcon,
  RestoreIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  AdministratorEntity,
  AssetAllocation,
  CatalogProduct,
  ManagerEntity,
} from "@/lib/portfolio-types";
import { useToast } from "@/components/ui/Toast";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import { CatalogSearch } from "@/components/admin/catalog/CatalogSearch";
import {
  CatalogFilters,
  EMPTY_CATALOG_FILTERS,
  type CatalogFilterState,
} from "@/components/admin/catalog/CatalogFilters";
import CreateCatalogModal from "@/components/admin/catalog/CreateCatalogModal"
import { CatalogObservationsBanner } from "@/components/admin/catalog/CatalogObservationsBanner";
import { ExcelManagedNotice } from "@/components/admin/catalog/ExcelManagedNotice";
import { AllocationListField } from "@/components/admin/catalog/AllocationListField";
import {
  EDITABLE_FIELDS,
  ModalField,
  NameListField,
  ScoredVocabularyField,
  allocationSum,
  isAllocationInvalid,
  modalInputClass,
  modalInputReadOnlyClass,
  parseReturnRate,
} from "@/components/admin/catalog/catalogFormShared";
import {
  EXCEL_MANAGED_HINT,
  isFieldReadOnly,
} from "@/lib/catalogManagedFields";
import {
  ASSET_CLASS_OPTIONS,
  CURRENCY_OPTIONS,
  GEOGRAPHIC_FOCUS_OPTIONS,
  UNDERLYING_OPTIONS,
} from "@/lib/catalogOptions";
import {
  countEntriesWithObservations,
  getObservations,
  observationDetail,
  summarizeObservations,
  type Observation,
  type ObservationLists,
} from "@/lib/catalogObservations";

// "listing" is the readable export; "sync" is the layout the SharePoint sync reads.
type ExportFormat = "listing" | "sync";

const CATALOG_COLUMNS: { key: keyof CatalogProduct; label: string }[] = [
  { key: "codigo", label: "Código" },
  { key: "alternative_names", label: "Nombres alternativos" },
  { key: "asset_class", label: "Clase de activo" },
  { key: "geographic_focus", label: "Foco geográfico" },
  { key: "underlying", label: "Subyacente" },
  { key: "commission", label: "Comisión" },
  { key: "currency", label: "Moneda" },
  { key: "administrator", label: "Administrador" },
  { key: "manager", label: "Gestor" },
  { key: "liquidity", label: "Liquidez" },
  { key: "return_rate", label: "Rentabilidad" },
  { key: "isin", label: "ISIN" },
  { key: "distribution", label: "Distribución" },
];

// Until pagination UI exists, request a high limit to preserve the
// current "whole table" behavior (the backend default is 50).
const CATALOG_PAGE_SIZE = 1000;

export default function AdminCatalogPage() {
  // useUrlSearch → useSearchParams requires a <Suspense> boundary in App Router.
  return (
    <Suspense
      fallback={<p className="text-sm text-sabbi-neutral-600">Cargando…</p>}
    >
      <CatalogPageContent />
    </Suspense>
  );
}

function CatalogPageContent() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<CatalogProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<CatalogProduct | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  // DB fields the Excel owns (GET /admin/catalog/excel-managed-fields). Empty
  // until loaded or if the call fails, which leaves every field editable.
  const [managedFields, setManagedFields] = useState<string[]>([]);
  // The whole active catalog, independent of search and filters: the
  // Observaciones banner counts over this, never over `entries`.
  const [allEntries, setAllEntries] = useState<CatalogProduct[] | null>(null);
  const [allEntriesFailed, setAllEntriesFailed] = useState(false);
  const allEntriesRequestRef = useRef(0);
  // Official manager/administrator names for the membership check. `null`
  // until loaded, which skips that check instead of flagging everything.
  const [managerNames, setManagerNames] = useState<string[] | null>(null);
  const [administratorNames, setAdministratorNames] = useState<string[] | null>(null);
  const [observationsOnly, setObservationsOnly] = useState(false);
  const [expandedObservationId, setExpandedObservationId] = useState<number | null>(null);

  // -- Search: input ↔ URL ↔ debounce --------------------------------
  const [searchInput, setSearchInput] = useUrlSearch("search");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [isFetching, setIsFetching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [filters, setFilters] = useState<CatalogFilterState>(EMPTY_CATALOG_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Which export is running, so each button can say "Exportando…" on its own
  // while both stay disabled.
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const isExporting = exportingFormat !== null;

  const isDebouncing =
    searchInput.trim() !== debouncedSearch.trim() &&
    searchInput.trim() !== "";

  const loadCatalog = useCallback(
    async (
      term: string,
      activeFilters: CatalogFilterState,
      includeDeleted: boolean,
      signal: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      if (term) params.set("search", term);
      params.set("limit", String(CATALOG_PAGE_SIZE));
      params.set("offset", "0");
      if (includeDeleted) params.set("include_deleted", "true");
      for (const [key, values] of Object.entries(activeFilters)) {
        for (const value of values) params.append(key, value);
      }

      const res = await fetchWithAuth(
        `/api/admin/catalog/entries?${params}`,
        { signal },
      );
      if (!res.ok) {
        throw new Error(
          `No se pudo cargar el catálogo (status ${res.status})`,
        );
      }
      const data: CatalogProduct[] = await res.json();
      setEntries(data);
    },
    [],
  );

const refetchCatalog = useCallback(async (): Promise<void> => {
  abortRef.current?.abort();

  const controller = new AbortController();
  abortRef.current = controller;

  try {
    await loadCatalog(debouncedSearch.trim(), filters, showDeleted, controller.signal);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return;
    }

    if (!controller.signal.aborted) {
      throw err;
    }
  }
}, [loadCatalog, debouncedSearch, filters, showDeleted]);

  useEffect(() => {
    const term = debouncedSearch.trim();

    // Cancel the previous request if the user types quickly
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setIsFetching(true);

    loadCatalog(term, filters, showDeleted, controller.signal)
      .catch((err: unknown) => {
        // Ignore cancellation errors (when the user types again)
        if (err instanceof Error && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Error desconocido");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFetching(false);
      });

    // Clean up on unmount
    return () => controller.abort();
  }, [debouncedSearch, filters, showDeleted, loadCatalog]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/catalog/excel-managed-fields");
        if (res.ok) {
          const fields: unknown = await res.json();
          if (Array.isArray(fields)) setManagedFields(fields);
        }
      } catch {
        // UI guard only (design ADR-13): the PATCH API still accepts these
        // fields, so failing open here never blocks an admin.
      }
    })();
  }, []);

  const loadAllEntries = useCallback(async (): Promise<void> => {
    const requestId = ++allEntriesRequestRef.current;
    try {
      const params = new URLSearchParams({
        limit: String(CATALOG_PAGE_SIZE),
        offset: "0",
      });
      const res = await fetchWithAuth(`/api/admin/catalog/entries?${params}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data: unknown = await res.json();
      // A newer request supersedes this one (e.g. two quick edits).
      if (requestId !== allEntriesRequestRef.current) return;
      if (!Array.isArray(data)) throw new Error("unexpected response");
      setAllEntries(data as CatalogProduct[]);
      setAllEntriesFailed(false);
    } catch {
      if (requestId === allEntriesRequestRef.current) setAllEntriesFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadAllEntries();
  }, [loadAllEntries]);

  // Table and banner must both reflect a create, edit, delete or restore.
  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([refetchCatalog(), loadAllEntries()]);
  }, [refetchCatalog, loadAllEntries]);

  useEffect(() => {
    (async () => {
      try {
        const [adminRes, managerRes] = await Promise.all([
          fetchWithAuth("/api/admin/administrators"),
          fetchWithAuth("/api/admin/managers"),
        ]);
        if (adminRes.ok) {
          const data: unknown = await adminRes.json();
          if (Array.isArray(data)) {
            setAdministratorNames((data as AdministratorEntity[]).map((a) => a.name));
          }
        }
        if (managerRes.ok) {
          const data: unknown = await managerRes.json();
          if (Array.isArray(data)) {
            setManagerNames((data as ManagerEntity[]).map((m) => m.name));
          }
        }
      } catch {
        // Membership of manager/administrator is simply not checked.
      }
    })();
  }, []);

  const observationLists = useMemo<ObservationLists>(
    () => ({
      asset_class: ASSET_CLASS_OPTIONS,
      geographic_focus: GEOGRAPHIC_FOCUS_OPTIONS,
      underlying: UNDERLYING_OPTIONS,
      currency: CURRENCY_OPTIONS,
      manager: managerNames,
      administrator: administratorNames,
    }),
    [managerNames, administratorNames],
  );

  const observationSummary = useMemo(
    () =>
      allEntries
        ? {
            groups: summarizeObservations(allEntries, observationLists),
            entriesWithObservations: countEntriesWithObservations(
              allEntries,
              observationLists,
            ),
          }
        : null,
    [allEntries, observationLists],
  );

  // Observations are a property of the row, so they are computed on the
  // rows shown. Deleted rows never carry any (they are not validated).
  const observationsById = useMemo(() => {
    const map = new Map<number, Observation[]>();
    for (const entry of entries ?? []) {
      map.set(
        entry.id,
        entry.is_deleted ? [] : getObservations(entry, observationLists),
      );
    }
    return map;
  }, [entries, observationLists]);

  // The "Observaciones" filter narrows what the server already returned for
  // the other filters and the search, so the three combine by AND.
  const visibleEntries = useMemo(() => {
    if (!entries) return null;
    if (!observationsOnly) return entries;
    return entries.filter((e) => (observationsById.get(e.id) ?? []).length > 0);
  }, [entries, observationsOnly, observationsById]);

  // Selection is page-level state (a set of catalog IDs), not per-row —
  // whenever the visible entries change (search, filters, or a delete),
  // drop any selected id that's no longer visible so "select all" never
  // silently exports rows the admin can no longer see
  // (openspec/changes/catalog-export-and-filters/design.md ADR-7).
  useEffect(() => {
    if (!visibleEntries) return;
    // Deleted entries are excluded too: they're never selectable for export
    // (they're already excluded server-side from the export itself, SD-06).
    // Uses the rows left after the Observaciones filter, so "select all" and
    // export never include rows the admin can no longer see.
    const selectableIds = new Set(
      visibleEntries.filter((e) => !e.is_deleted).map((e) => e.id),
    );
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => selectableIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleEntries]);

  const handleExport = async (format: ExportFormat = "listing") => {
    if (selectedIds.size === 0) return;
    setExportingFormat(format);
    try {
      // The readable export keeps sending exactly what it always did.
      const ids = Array.from(selectedIds);
      const res = await fetchWithAuth("/api/admin/catalog/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(format === "sync" ? { ids, format } : { ids }),
      });
      if (!res.ok) {
        let message = "No se pudo exportar el catálogo";
        if (format === "sync") {
          // e.g. none of the selected products has a codigo
          try {
            const body = await res.json();
            if (typeof body?.detail === "string") message = body.detail;
          } catch {
            // keep the generic message
          }
        }
        toast(message);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="(.+)"/);
      const filename =
        match?.[1] ??
        (format === "sync" ? "catalogo-sabbi-sharepoint.xlsx" : "catalogo-sabbi.xlsx");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      // The sync matches rows by codigo, so products without one are left out.
      const skipped = Number(res.headers.get("X-Skipped-Without-Codigo") ?? 0);
      if (format === "sync" && skipped > 0) {
        toast(
          skipped === 1
            ? "1 producto sin código no se incluyó en el archivo"
            : `${skipped} productos sin código no se incluyeron en el archivo`,
        );
      }
    } catch {
      toast("No se pudo exportar el catálogo");
    } finally {
      setExportingFormat(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setConfirmDeleteId(null);

    try {
      const res = await fetchWithAuth(`/api/admin/catalog/entries/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(
          `No se pudo eliminar la entrada (status ${res.status})`,
        );
      }
      await new Promise((r) => setTimeout(r, 400));
      // Refetch instead of filtering the row out locally: this is a soft
      // delete, so with "Ver eliminados" active the row should reappear
      // marked as eliminada, not disappear from the table.
      await refreshAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestore = async (id: number) => {
    setRestoringId(id);
    try {
      const res = await fetchWithAuth(
        `/api/admin/catalog/entries/${id}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        throw new Error(
          `No se pudo restaurar la entrada (status ${res.status})`,
        );
      }
      await refreshAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setRestoringId(null);
    }
  };

  const handleUpdated = (updated: CatalogProduct) => {
    setEntries((prev) =>
      (prev ?? []).map((e) => (e.id === updated.id ? updated : e)),
    );
    void loadAllEntries();
  };

  // Determine whether we're in search mode for the empty-state message
  const isSearchMode = debouncedSearch.trim() !== "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">
          Catálogo
        </h1>
        <div className="w-full sm:w-80">
          <CatalogSearch
            value={searchInput}
            onChange={setSearchInput}
            isLoading={isFetching || isDebouncing}
          />
        </div>
      </div>

      <CatalogObservationsBanner
        groups={observationSummary?.groups ?? null}
        entriesWithObservations={observationSummary?.entriesWithObservations ?? 0}
        failed={allEntriesFailed}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <CatalogFilters value={filters} onChange={setFilters} />
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

      {entries === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : visibleEntries && visibleEntries.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">
          {observationsOnly
            ? "Ningún producto tiene observaciones con los filtros actuales."
            : isSearchMode
              ? "No se encontraron productos."
              : "No hay entradas en el catálogo."}
        </p>
      ) : (
        visibleEntries && (
          <div className="max-h-[75vh] overflow-auto rounded-xl border border-sabbi-neutral-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-30 bg-sabbi-neutral-50 text-xs font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                <tr>
                  <th className="sticky top-0 left-0 z-40 w-10 bg-sabbi-neutral-50 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todo"
                      checked={(() => {
                        const selectable = (visibleEntries ?? []).filter((e) => !e.is_deleted);
                        return selectable.length > 0 && selectable.every((e) => selectedIds.has(e.id));
                      })()}
                      onChange={(e) => {
                        if (!visibleEntries) return;
                        const selectable = visibleEntries.filter((entry) => !entry.is_deleted);
                        setSelectedIds(
                          e.target.checked ? new Set(selectable.map((entry) => entry.id)) : new Set(),
                        );
                      }}
                    />
                  </th>
                  <th className="sticky top-0 left-10 z-40 bg-sabbi-neutral-50 px-4 py-2 whitespace-nowrap after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-sabbi-neutral-200">
                    Nombre
                  </th>
                  {CATALOG_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className="px-4 py-2 whitespace-nowrap"
                    >
                      {column.label}
                    </th>
                  ))}
                  <th className="sticky top-0 right-0 z-40 bg-sabbi-neutral-50 px-4 py-2 text-center whitespace-nowrap before:absolute before:top-0 before:left-0 before:h-full before:w-px before:bg-sabbi-neutral-200">
                    Opciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry, index) => {
                  const isOdd = index % 2 === 1;
                  const isDeleted = entry.is_deleted;
                  const rowBg = isDeleted
                    ? "bg-sabbi-neutral-100"
                    : isOdd
                      ? "bg-sabbi-neutral-50"
                      : "bg-white";
                  const hoverBg = isDeleted ? "" : "group-hover:bg-[#f0fcd4]";
                  const isDeleting = deletingId === entry.id;
                  const isRestoring = restoringId === entry.id;
                  const observations = observationsById.get(entry.id) ?? [];
                  const observationsExpanded =
                    expandedObservationId === entry.id && observations.length > 0;
                  return (
                    <Fragment key={entry.id}>
                    <tr
                      className={`group transition-colors ${isDeleting ? "animate-row-delete" : `${rowBg} ${hoverBg}`}`}
                    >
                      <td
                        className={`sticky left-0 z-10 w-10 px-3 py-2 ${isDeleting ? "" : `${rowBg} ${hoverBg}`}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${entry.name || "producto"}`}
                          checked={!isDeleted && selectedIds.has(entry.id)}
                          disabled={isDeleted}
                          onChange={() => {
                            if (isDeleted) return;
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            });
                          }}
                          className="disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </td>
                      <td
                        className={`sticky left-10 z-10 px-4 py-2 font-medium whitespace-nowrap text-sabbi-neutral-900 after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-sabbi-neutral-200 ${isDeleting ? "" : `${rowBg} ${hoverBg}`}`}
                      >
                        <span className={isDeleted ? "text-sabbi-neutral-500" : ""}>
                          {entry.name || "—"}
                        </span>
                        {isDeleted && (
                          <span className="ml-2 rounded-full bg-sabbi-neutral-200 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                            Eliminado
                          </span>
                        )}
                        {observations.length > 0 && (
                          <button
                            type="button"
                            aria-expanded={observationsExpanded}
                            aria-label={`Ver observaciones de ${entry.name}`}
                            title={observations.map(observationDetail).join("\n")}
                            onClick={() =>
                              setExpandedObservationId((prev) =>
                                prev === entry.id ? null : entry.id,
                              )
                            }
                            className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-800 uppercase hover:bg-amber-200"
                          >
                            {observations.length}{" "}
                            {observations.length === 1 ? "observación" : "observaciones"}
                          </button>
                        )}
                      </td>
                      {CATALOG_COLUMNS.map((column) => {
                        const val = entry[column.key];
                        const display = Array.isArray(val)
                          ? val
                              .map((v) =>
                                typeof v === "object" && v && "name" in v
                                  ? `${(v as { name: string; percentage: number }).name} ${(v as { name: string; percentage: number }).percentage}%`
                                  : v,
                              )
                              .join(", ")
                          : val;
                        return (
                          <td
                            key={column.key}
                            className="px-4 py-2 whitespace-nowrap text-sabbi-neutral-900"
                          >
                            {display || "—"}
                          </td>
                        );
                      })}
                      <td
                        className={`sticky right-0 z-10 px-4 py-2 whitespace-nowrap before:absolute before:top-0 before:left-0 before:h-full before:w-px before:bg-sabbi-neutral-200 ${isDeleting ? "" : `${rowBg} ${hoverBg}`}`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {isDeleted ? (
                            <button
                              type="button"
                              title="Restaurar"
                              disabled={isRestoring}
                              onClick={() => void handleRestore(entry.id)}
                              className="rounded-md p-1.5 text-sabbi-neutral-500 transition-colors hover:bg-green-50 hover:text-green-700 disabled:opacity-50"
                            >
                              <RestoreIcon size={16} />
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                title="Editar"
                                onClick={() => setEditingEntry(entry)}
                                className="rounded-md p-1.5 text-sabbi-neutral-500 transition-colors hover:bg-sabbi-neutral-100 hover:text-sabbi-neutral-900"
                              >
                                <EditIcon size={16} />
                              </button>
                              <button
                                type="button"
                                title="Eliminar"
                                disabled={deletingId === entry.id}
                                onClick={() => setConfirmDeleteId(entry.id)}
                                className="rounded-md p-1.5 text-sabbi-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              >
                                <TrashIcon size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {observationsExpanded && (
                      <tr className="bg-amber-50">
                        <td
                          colSpan={CATALOG_COLUMNS.length + 3}
                          className="px-4 py-2 text-sm text-amber-900"
                        >
                          <p className="font-medium">
                            {entry.codigo ?? "Sin código"} · {entry.name}
                          </p>
                          <ul className="mt-1 list-disc pl-5">
                            {observations.map((observation) => (
                              <li key={`${observation.field}:${observation.issue}:${observation.value}`}>
                                {observationDetail(observation)}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-sabbi-neutral-500">
          {selectedIds.size > 0 ? `${selectedIds.size} seleccionados` : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleExport("listing")}
            disabled={selectedIds.size === 0 || isExporting}
            className="flex items-center gap-1.5 rounded-lg border border-sabbi-neutral-200 px-4 py-2 text-sm font-medium text-sabbi-neutral-700 transition-colors hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DownloadIcon size={16} />
            {exportingFormat === "listing" ? "Exportando…" : "Exportar seleccionados"}
          </button>
          <button
            type="button"
            onClick={() => void handleExport("sync")}
            disabled={selectedIds.size === 0 || isExporting}
            title="Genera el archivo con el formato del Excel de SharePoint. Los productos sin código no se incluyen."
            className="flex items-center gap-1.5 rounded-lg border border-sabbi-neutral-200 px-4 py-2 text-sm font-medium text-sabbi-neutral-700 transition-colors hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DownloadIcon size={16} />
            {exportingFormat === "sync" ? "Exportando…" : "Exportar para SharePoint"}
          </button>
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium
            text-white transition-colors hover:bg-sabbi-primary-hover"
          >
            Agregar
          </button>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId !== null) void handleDelete(confirmDeleteId);
        }}
      />

      <EditCatalogModal
        entry={editingEntry}
        managedFields={managedFields}
        onClose={() => setEditingEntry(null)}
        onSaved={handleUpdated}
      />
      {isCreateModalOpen && (
        <CreateCatalogModal
          onClose={() => setIsCreateModalOpen(false)}
          onSaved={refreshAll}
        />
      )}
    </div>
  );
}

// -- Confirm delete dialog ------------------------------------------------

function ConfirmDeleteDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="animate-modal-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-sabbi-neutral-900">
          Eliminar entrada
        </h3>
        <p className="mt-2 text-sm text-sabbi-neutral-600">
          Esta acción no se puede deshacer. ¿Confirmar eliminación?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Edit catalog modal ---------------------------------------------------
//
// EDITABLE_FIELDS, allocationSum/isAllocationInvalid, parseReturnRate,
// ScoredVocabularyField, and NameListField live in
// `@/components/admin/catalog/catalogFormShared` — CreateCatalogModal uses
// the exact same implementations so the two modals can't drift apart again.

/**
 * Resolves the score to show for a saved administrator/manager name: the
 * per-product snapshot if one was ever saved, otherwise the entity's
 * current score IF the match is unambiguous (score_is_fixed !== false).
 * Returns null when genuinely nothing can be prefilled ("Cash o efectivo",
 * or a name no longer in the entity list) — that's still a real gap the
 * admin must fill in manually, not a bug.
 */
function prefillScore(
  savedScore: number | null,
  name: string,
  entities: { name: string; score: number | null; score_is_fixed?: boolean }[],
): number | null {
  if (savedScore !== null) return savedScore;
  const matched = entities.find((e) => e.name === name);
  return matched && matched.score_is_fixed !== false ? matched.score : null;
}

function EditCatalogModal({
  entry,
  managedFields,
  onClose,
  onSaved,
}: {
  entry: CatalogProduct | null;
  managedFields: readonly string[];
  onClose: () => void;
  onSaved: (updated: CatalogProduct) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [alternativeNames, setAlternativeNames] = useState<string[]>([]);
  const [geographicFocus, setGeographicFocus] = useState<AssetAllocation[]>([]);
  const [assetClass, setAssetClass] = useState<AssetAllocation[]>([]);
  const [underlying, setUnderlying] = useState<AssetAllocation[]>([]);
  const [returnRateMin, setReturnRateMin] = useState("");
  const [returnRateMax, setReturnRateMax] = useState("");
  const [administratorScore, setAdministratorScore] = useState<number | null>(null);
  const [managerScore, setManagerScore] = useState<number | null>(null);
  const [administratorEntities, setAdministratorEntities] = useState<AdministratorEntity[]>([]);
  const [managerEntities, setManagerEntities] = useState<ManagerEntity[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetched once for the modal's lifetime (not re-fetched per open) — backs
  // the Administrador/Gestor dropdowns, replacing the old hardcoded
  // ADMINISTRATOR_OPTIONS/MANAGER_OPTIONS arrays.
  useEffect(() => {
    (async () => {
      try {
        const [adminRes, managerRes] = await Promise.all([
          fetchWithAuth("/api/admin/administrators"),
          fetchWithAuth("/api/admin/managers"),
        ]);
        if (adminRes.ok) setAdministratorEntities(await adminRes.json());
        if (managerRes.ok) setManagerEntities(await managerRes.json());
      } catch {
        // Dropdowns just stay empty; the free-text "add new" input still works.
      }
    })();
  }, []);

  useEffect(() => {
    if (!entry) return;
    const initial: Record<string, string> = {};
    for (const field of EDITABLE_FIELDS) {
      if (
        field.key === "alternative_names" ||
        field.key === "geographic_focus" ||
        field.key === "asset_class" ||
        field.key === "underlying" ||
        field.key === "return_rate"
      )
        continue;
      const val = entry[field.key as keyof CatalogProduct];
      initial[field.key] = Array.isArray(val)
        ? val.join("\n")
        : String(val ?? "");
    }
    setForm(initial);
    setAlternativeNames(entry.alternative_names ?? []);
    setGeographicFocus(entry.geographic_focus ?? []);
    setAssetClass(entry.asset_class ?? []);
    const parsedReturnRate = parseReturnRate(String(entry.return_rate ?? ""));
    setReturnRateMin(parsedReturnRate.min);
    setReturnRateMax(parsedReturnRate.max);
    setUnderlying(entry.underlying ?? []);
    setErrorMessage(null);
  }, [entry]);

  // Separate from the effect above so it can depend on the entity lists too
  // (fetched async, may not be ready on the very first render) without
  // re-running the rest of the form init whenever they resolve.
  //
  // Legacy entries have administrator_score/manager_score = NULL (this
  // migration didn't backfill them, unlike `slugs`) — falling back to null
  // here left the score field empty AND locked read-only whenever the saved
  // name matched a fixed-score entity, with no way to fix it short of
  // reselecting the same name from the dropdown. If the saved name
  // unambiguously matches a fixed-score entity, there's nothing actually
  // uncertain about it, so prefill from that entity instead of leaving it
  // blocked. Stays empty only for genuine ambiguity: "Cash o efectivo"
  // (score_is_fixed=false) or a legacy name no longer in the entity list.
  useEffect(() => {
    if (!entry) return;
    setAdministratorScore(
      prefillScore(entry.administrator_score ?? null, entry.administrator, administratorEntities),
    );
    setManagerScore(prefillScore(entry.manager_score ?? null, entry.manager, managerEntities));
  }, [entry, administratorEntities, managerEntities]);

  useEffect(() => {
    if (!entry) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [entry, onClose]);

  if (!entry) return null;

  // Fields the Excel owns are shown read-only, so their validation must not
  // block saving the editable ones (EM-05): every required/sum check below is
  // skipped for a read-only field.
  const readOnly = (key: string) => isFieldReadOnly(entry, managedFields, key);

  const nameInvalid = !readOnly("name") && (form.name ?? "").trim() === "";
  const geoTotal = allocationSum(geographicFocus);
  const geoEmpty = !readOnly("geographic_focus") && geographicFocus.length === 0;
  const geoInvalid = !readOnly("geographic_focus") && isAllocationInvalid(geographicFocus);
  const assetClassTotal = allocationSum(assetClass);
  const assetClassEmpty = !readOnly("asset_class") && assetClass.length === 0;
  const assetClassInvalid = !readOnly("asset_class") && isAllocationInvalid(assetClass);
  const underlyingTotal = allocationSum(underlying);
  const underlyingEmpty = !readOnly("underlying") && underlying.length === 0;
  const underlyingInvalid = !readOnly("underlying") && isAllocationInvalid(underlying);
  const commissionInvalid = !readOnly("commission") && (form.commission ?? "").trim() === "";
  const currencyInvalid = !readOnly("currency") && (form.currency ?? "").trim() === "";
  const administratorBlank = (form.administrator ?? "").trim() === "";
  const managerBlank = (form.manager ?? "").trim() === "";
  const administratorInvalid = !readOnly("administrator") && administratorBlank;
  const managerInvalid = !readOnly("manager") && managerBlank;
  // Scores have no Excel column, so they stay required whenever a name is
  // set, even when the name itself is read-only.
  const administratorScoreMissing = !administratorBlank && administratorScore === null;
  const managerScoreMissing = !managerBlank && managerScore === null;
  const returnRateMinRequired = !readOnly("return_rate") && returnRateMin.trim() === "";
  const returnRateOrderInvalid =
    !readOnly("return_rate") &&
    returnRateMin !== "" &&
    returnRateMax !== "" &&
    parseFloat(returnRateMin) > parseFloat(returnRateMax);

  const handleSave = async () => {
    setErrorMessage(null);
    const invalidMessages: string[] = [];
    if (nameInvalid) {
      invalidMessages.push("El nombre es obligatorio");
    }
    if (assetClassEmpty) {
      invalidMessages.push("Clase de activo es obligatorio");
    } else if (assetClassInvalid) {
      invalidMessages.push(
        `Clase de activo debe sumar 100% (actual: ${assetClassTotal.toFixed(1)}%)`,
      );
    }
    if (geoEmpty) {
      invalidMessages.push("Foco geográfico es obligatorio");
    } else if (geoInvalid) {
      invalidMessages.push(
        `Foco geográfico debe sumar 100% (actual: ${geoTotal.toFixed(1)}%)`,
      );
    }
    if (underlyingEmpty) {
      invalidMessages.push("Subyacente es obligatorio");
    } else if (underlyingInvalid) {
      invalidMessages.push(
        `Subyacentes debe sumar 100% (actual: ${underlyingTotal.toFixed(1)}%)`,
      );
    }
    if (commissionInvalid) {
      invalidMessages.push("La comisión es obligatoria");
    }
    if (currencyInvalid) {
      invalidMessages.push("La moneda es obligatoria");
    }
    if (administratorInvalid) {
      invalidMessages.push("El administrador es obligatorio");
    }
    if (managerInvalid) {
      invalidMessages.push("El gestor es obligatorio");
    }
    if (administratorScoreMissing) {
      invalidMessages.push("El score del administrador es obligatorio");
    }
    if (managerScoreMissing) {
      invalidMessages.push("El score del gestor es obligatorio");
    }
    if (returnRateMinRequired) {
      invalidMessages.push("Rentabilidad: el mínimo es obligatorio");
    }
    if (returnRateOrderInvalid) {
      invalidMessages.push("Rentabilidad: el mínimo no puede ser mayor al máximo");
    }
    if (invalidMessages.length > 0) {
      setErrorMessage(invalidMessages.join(" · "));
      return;
    }
    setIsSubmitting(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const field of EDITABLE_FIELDS) {
        if (
          field.key === "alternative_names" ||
          field.key === "geographic_focus" ||
          field.key === "asset_class" ||
          field.key === "underlying" ||
          field.key === "return_rate" ||
          readOnly(field.key)
        )
          continue;
        const current = form[field.key]?.trim() ?? "";
        const original = String(entry[field.key as keyof CatalogProduct] ?? "");
        if (current !== original) {
          patch[field.key] = current;
        }
      }

      const alternativeNamesOriginal = (entry.alternative_names ?? []) as string[];
      if (
        !readOnly("alternative_names") &&
        JSON.stringify(alternativeNames) !== JSON.stringify(alternativeNamesOriginal)
      ) {
        patch.alternative_names = alternativeNames;
      }

      const geoOriginal = (entry.geographic_focus ?? []) as AssetAllocation[];
      if (
        !readOnly("geographic_focus") &&
        JSON.stringify(geographicFocus) !== JSON.stringify(geoOriginal)
      ) {
        patch.geographic_focus = geographicFocus;
      }

      const assetClassOriginal = (entry.asset_class ?? []) as AssetAllocation[];
      if (
        !readOnly("asset_class") &&
        JSON.stringify(assetClass) !== JSON.stringify(assetClassOriginal)
      ) {
        patch.asset_class = assetClass;
      }

      const underlyingOriginal = (entry.underlying ?? []) as AssetAllocation[];
      if (
        !readOnly("underlying") &&
        JSON.stringify(underlying) !== JSON.stringify(underlyingOriginal)
      ) {
        patch.underlying = underlying;
      }

      const returnRateOriginal = parseReturnRate(String(entry.return_rate ?? ""));
      if (
        !readOnly("return_rate") &&
        (returnRateMin !== returnRateOriginal.min ||
          returnRateMax !== returnRateOriginal.max)
      ) {
        patch.return_rate =
          returnRateMin === ""
            ? ""
            : returnRateMax === ""
              ? `${returnRateMin}%`
              : `${returnRateMin}% - ${returnRateMax}%`;
      }

      // administrator_score/manager_score live in their own state, not
      // `form` — force them into the patch whenever the name changed too,
      // even if the score's raw value happens to match the original. The
      // backend requires both together in one PATCH whenever the name is
      // present (CatalogProductUpdate._validate_administrator_score).
      if ("administrator" in patch || administratorScore !== (entry.administrator_score ?? null)) {
        patch.administrator_score = administratorScore;
      }
      if ("manager" in patch || managerScore !== (entry.manager_score ?? null)) {
        patch.manager_score = managerScore;
      }

      // A brand-new name typed into "+ Agregar..." isn't in the fetched
      // entity list yet — persist it as a reusable entity (task_fffceb1e).
      // Best-effort: a failure here (e.g. a race against another admin
      // adding the same name) doesn't block saving the catalog entry
      // itself, which stores this name+score directly either way.
      const administratorName = form.administrator?.trim() ?? "";
      if (
        administratorName &&
        administratorScore !== null &&
        !administratorEntities.some((a) => a.name === administratorName)
      ) {
        try {
          await fetchWithAuth("/api/admin/administrators", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: administratorName, score: administratorScore }),
          });
        } catch {
          // best-effort — see comment above
        }
      }
      const managerName = form.manager?.trim() ?? "";
      if (
        managerName &&
        managerScore !== null &&
        !managerEntities.some((m) => m.name === managerName)
      ) {
        try {
          await fetchWithAuth("/api/admin/managers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: managerName, score: managerScore }),
          });
        } catch {
          // best-effort — see comment above
        }
      }

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      const res = await fetchWithAuth(
        `/api/admin/catalog/entries/${entry.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        let detail = `No se pudo actualizar (status ${res.status})`;
        try {
          const body = await res.json();
          if (body?.detail) {
            detail = Array.isArray(body.detail)
              ? body.detail
                  .map((d: unknown) =>
                    d && typeof d === "object" && "msg" in d
                      ? String((d as { msg: unknown }).msg)
                      : JSON.stringify(d),
                  )
                  .join("; ")
              : String(body.detail);
          }
        } catch {
          // Response wasn't JSON; keep the generic message.
        }
        throw new Error(detail);
      }
      const updated: CatalogProduct = await res.json();
      onSaved(updated);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo actualizar",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            Editar entrada del catálogo
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
          >
            <XIcon size={16} />
          </button>
        </div>

        <ExcelManagedNotice codigo={entry.codigo} />

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          {EDITABLE_FIELDS.map(({ key, label }) => {
            const ro = readOnly(key);
            const hint = ro ? EXCEL_MANAGED_HINT : undefined;
            switch (key) {
              case "alternative_names":
                return (
                  <ModalField key={key} label={label} hint={hint}>
                    <NameListField
                      key={entry.id}
                      value={alternativeNames}
                      onChange={setAlternativeNames}
                      addPlaceholder="+ Agregar nombre alternativo"
                      disabled={ro}
                    />
                  </ModalField>
                );
              case "asset_class":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <AllocationListField
                      options={ASSET_CLASS_OPTIONS}
                      value={assetClass}
                      onChange={setAssetClass}
                      addLabel="Agregar clase de activo"
                      disabled={ro}
                      required
                    />
                  </ModalField>
                );
              case "geographic_focus":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <AllocationListField
                      options={GEOGRAPHIC_FOCUS_OPTIONS}
                      value={geographicFocus}
                      onChange={setGeographicFocus}
                      addLabel="Agregar foco geográfico"
                      disabled={ro}
                      required
                    />
                  </ModalField>
                );
              case "underlying":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <AllocationListField
                      options={UNDERLYING_OPTIONS}
                      value={underlying}
                      onChange={setUnderlying}
                      addLabel="Agregar subyacente"
                      disabled={ro}
                      required
                    />
                  </ModalField>
                );
              case "commission":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      disabled={ro}
                      className={
                        modalInputClass +
                        (ro ? modalInputReadOnlyClass : "") +
                        (commissionInvalid ? " border-red-400 focus:border-red-500" : "")
                      }
                    />
                  </ModalField>
                );
              case "currency":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <select
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      disabled={ro}
                      className={
                        modalInputClass +
                        (ro ? modalInputReadOnlyClass : "") +
                        (currencyInvalid ? " border-red-400 focus:border-red-500" : "")
                      }
                    >
                      <option value="">—</option>
                      {form[key] && !(CURRENCY_OPTIONS as readonly string[]).includes(form[key]) && (
                        <option value={form[key]}>{form[key]}</option>
                      )}
                      {CURRENCY_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ModalField>
                );
              case "administrator":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <ScoredVocabularyField
                      key={entry.id}
                      entities={administratorEntities}
                      name={form[key] ?? ""}
                      score={administratorScore}
                      onNameChange={(v) => updateField(key, v)}
                      onScoreChange={setAdministratorScore}
                      addPlaceholder="+ Agregar administrador"
                      disabled={ro}
                      nameInvalid={administratorInvalid}
                      scoreInvalid={administratorScoreMissing}
                    />
                  </ModalField>
                );
              case "manager":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <ScoredVocabularyField
                      key={entry.id}
                      entities={managerEntities}
                      name={form[key] ?? ""}
                      score={managerScore}
                      onNameChange={(v) => updateField(key, v)}
                      onScoreChange={setManagerScore}
                      addPlaceholder="+ Agregar gestor"
                      disabled={ro}
                      nameInvalid={managerInvalid}
                      scoreInvalid={managerScoreMissing}
                    />
                  </ModalField>
                );
              case "return_rate":
                return (
                  <ModalField key={key} label={label} hint={hint}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-sabbi-neutral-500">
                        min{!ro && <span className="text-red-600">*</span>}
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        value={returnRateMin}
                        onChange={(e) => setReturnRateMin(e.target.value)}
                        disabled={ro}
                        className={
                          modalInputClass +
                          (ro ? modalInputReadOnlyClass : "") +
                          " w-0 min-w-0 flex-1" +
                          (returnRateMinRequired || returnRateOrderInvalid
                            ? " border-red-400 focus:border-red-500"
                            : "")
                        }
                      />
                      <span className="text-sm text-sabbi-neutral-500">%</span>
                      <span className="text-sabbi-neutral-400">-</span>
                      <span className="text-xs text-sabbi-neutral-500">max</span>
                      <input
                        type="number"
                        step="0.01"
                        value={returnRateMax}
                        onChange={(e) => setReturnRateMax(e.target.value)}
                        disabled={ro}
                        className={
                          modalInputClass +
                          (ro ? modalInputReadOnlyClass : "") +
                          " w-0 min-w-0 flex-1" +
                          (returnRateOrderInvalid ? " border-red-400 focus:border-red-500" : "")
                        }
                      />
                      <span className="text-sm text-sabbi-neutral-500">%</span>
                    </div>
                  </ModalField>
                );
              case "name":
                return (
                  <ModalField key={key} label={label} hint={hint} required={!ro}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      disabled={ro}
                      className={
                        modalInputClass +
                        (ro ? modalInputReadOnlyClass : "") +
                        (nameInvalid ? " border-red-400 focus:border-red-500" : "")
                      }
                    />
                  </ModalField>
                );
              case "isin":
                return (
                  <ModalField key={key} label={label} hint={hint}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      placeholder="Agregar ISIN"
                      disabled={ro}
                      className={modalInputClass + (ro ? modalInputReadOnlyClass : "")}
                    />
                  </ModalField>
                );
              case "distribution":
                return (
                  <ModalField key={key} label={label} hint={hint}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      placeholder="Agregar distribución"
                      disabled={ro}
                      className={modalInputClass + (ro ? modalInputReadOnlyClass : "")}
                    />
                  </ModalField>
                );
              default:
                return (
                  <ModalField key={key} label={label} hint={hint}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      disabled={ro}
                      className={modalInputClass + (ro ? modalInputReadOnlyClass : "")}
                    />
                  </ModalField>
                );
            }
          })}
          {isFieldReadOnly(entry, managedFields, "cash_flows") && (
            <ModalField label="Flujos" hint={EXCEL_MANAGED_HINT}>
              <input
                value={entry.cash_flows ?? ""}
                disabled
                readOnly
                className={modalInputClass + modalInputReadOnlyClass}
              />
            </ModalField>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-sabbi-neutral-200 px-5 py-4">
          <p className="min-h-4 text-sm text-red-600">{errorMessage}</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={
                isSubmitting ||
                nameInvalid ||
                geoEmpty ||
                geoInvalid ||
                assetClassEmpty ||
                assetClassInvalid ||
                underlyingEmpty ||
                underlyingInvalid ||
                commissionInvalid ||
                currencyInvalid ||
                administratorInvalid ||
                managerInvalid ||
                administratorScoreMissing ||
                managerScoreMissing ||
                returnRateMinRequired ||
                returnRateOrderInvalid
              }
              onClick={() => void handleSave()}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

