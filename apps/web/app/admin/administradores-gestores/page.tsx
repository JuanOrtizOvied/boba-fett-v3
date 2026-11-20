"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import { useToast } from "@/components/ui/Toast";
import { EntityScoreDeleteModal } from "@/components/admin/entity-scores/EntityScoreDeleteModal";
import { EntityScoreFormModal } from "@/components/admin/entity-scores/EntityScoreFormModal";
import { EntityScoreSearch } from "@/components/admin/entity-scores/EntityScoreSearch";
import { EntityScoreTable } from "@/components/admin/entity-scores/EntityScoreTable";
import {
  ENTITY_KINDS,
  KIND_TEXT,
  SEARCH_PARAM,
  activeRows,
  deletedCount,
  describeWriteError,
  listEntityScores,
  restoreEntityScore,
  tabFromParam,
  tabToParam,
  type EntityKind,
  type EntityScore,
} from "@/lib/entityScores";

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

const message = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

type Lists = Record<EntityKind, EntityScore[] | null>;
type Errors = Record<EntityKind, string | null>;
type ModalState =
  | { type: "form"; mode: "create" | "edit"; entity: EntityScore | null }
  | { type: "delete"; entity: EntityScore }
  | null;

export default function EntityScoresPage() {
  // useUrlSearch -> useSearchParams requires a <Suspense> boundary in App Router.
  return (
    <Suspense fallback={<p className="text-sm text-sabbi-neutral-600">Cargando…</p>}>
      <EntityScoresContent />
    </Suspense>
  );
}

function EntityScoresContent() {
  const { toast } = useToast();
  const [tabParam, setTabParam] = useUrlSearch("tab");
  const kind = tabFromParam(tabParam);

  // Each tab keeps its own term in its own URL parameter, and each is debounced on its
  // own so switching tabs never searches the other tab with the wrong term.
  const [adminInput, setAdminInput] = useUrlSearch(SEARCH_PARAM.administrators);
  const [managerInput, setManagerInput] = useUrlSearch(SEARCH_PARAM.managers);
  const debouncedAdmin = useDebouncedValue(adminInput, 300);
  const debouncedManager = useDebouncedValue(managerInput, 300);
  const searchInput = kind === "administrators" ? adminInput : managerInput;
  const setSearchInput = kind === "administrators" ? setAdminInput : setManagerInput;
  const term = (kind === "administrators" ? debouncedAdmin : debouncedManager).trim();
  const isDebouncing = searchInput.trim() !== term && searchInput.trim() !== "";

  const [showDeleted, setShowDeleted] = useState(false);

  // Both tables are read once, whole (about 120 rows each, deleted ones included): they
  // give the totals of the tabs and the rows shown while there is no search term.
  const [lists, setLists] = useState<Lists>({ administrators: null, managers: null });
  const [listErrors, setListErrors] = useState<Errors>({ administrators: null, managers: null });

  // A search asks the server for the active tab only.
  const [filtered, setFiltered] = useState<{
    kind: EntityKind;
    showDeleted: boolean;
    rows: EntityScore[];
  } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  // Bumped after a write, so a search that is on screen asks the server again.
  const [searchKey, setSearchKey] = useState(0);

  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadKind = useCallback(async (k: EntityKind, signal?: AbortSignal) => {
    try {
      const rows = await listEntityScores(k, { includeDeleted: true, signal });
      if (signal?.aborted) return;
      setLists((prev) => ({ ...prev, [k]: rows }));
      setListErrors((prev) => ({ ...prev, [k]: null }));
    } catch (err) {
      if (signal?.aborted || isAbort(err)) return;
      setListErrors((prev) => ({
        ...prev,
        [k]: message(err, `No se pudieron cargar los ${KIND_TEXT[k].plural}`),
      }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    for (const k of ENTITY_KINDS) void loadKind(k, controller.signal);
    return () => controller.abort();
  }, [loadKind]);

  useEffect(() => {
    if (term === "") {
      setSearchError(null);
      setIsFetching(false);
      return;
    }
    const controller = new AbortController();
    setSearchError(null);
    setIsFetching(true);
    listEntityScores(kind, { search: term, includeDeleted: showDeleted, signal: controller.signal })
      .then((rows) => {
        if (!controller.signal.aborted) setFiltered({ kind, showDeleted, rows });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || isAbort(err)) return;
        setFiltered(null);
        setSearchError(message(err, `No se pudieron cargar los ${KIND_TEXT[kind].plural}`));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFetching(false);
      });
    return () => controller.abort();
  }, [kind, term, showDeleted, searchKey]);

  /** After a write: read the table again (the totals follow) and the search, if any. */
  const refresh = useCallback(() => {
    void loadKind(kind);
    setSearchKey((n) => n + 1);
  }, [kind, loadKind]);

  const singular = KIND_TEXT[kind].singular;

  const handleSaved = (_saved: EntityScore, mode: "create" | "edit") => {
    setModal(null);
    refresh();
    toast(`${capitalize(singular)} ${mode === "create" ? "creado" : "guardado"}`, "success");
  };

  const handleDeleted = () => {
    setModal(null);
    refresh();
    toast(`${capitalize(singular)} eliminado`, "success");
  };

  const handleRestore = async (row: EntityScore) => {
    setBusyId(row.id);
    try {
      await restoreEntityScore(kind, row.id);
      refresh();
      toast(`${capitalize(singular)} restaurado`, "success");
    } catch (err) {
      const described = describeWriteError(err, kind);
      toast(described.form ?? `No se pudo restaurar el ${singular}`);
      if (described.gone) refresh();
    } finally {
      setBusyId(null);
    }
  };

  const all = lists[kind];
  let rows: EntityScore[] | null;
  if (term === "") {
    rows = all === null ? null : showDeleted ? all : activeRows(all);
  } else {
    rows =
      filtered !== null && filtered.kind === kind && filtered.showDeleted === showDeleted
        ? filtered.rows
        : null;
  }
  const error = term === "" ? listErrors[kind] : searchError;
  const total = all === null ? null : showDeleted ? all.length : activeRows(all).length;
  const text = KIND_TEXT[kind];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">Administradores y gestores</h1>
        <button
          type="button"
          onClick={() => setModal({ type: "form", mode: "create", entity: null })}
          disabled={all === null}
          className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-50"
        >
          + Nuevo {text.singular}
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Tabla"
        className="flex w-fit overflow-hidden rounded-lg border border-sabbi-neutral-200 bg-white"
      >
        {ENTITY_KINDS.map((k, index) => {
          const selected = k === kind;
          const list = lists[k];
          return (
            <button
              key={k}
              id={`entity-tab-${k}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="entity-panel"
              onClick={() => setTabParam(tabToParam(k))}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-colors ${
                index > 0 ? "border-l border-sabbi-neutral-200" : ""
              } ${selected ? "text-sabbi-neutral-900" : "text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"}`}
              style={selected ? { backgroundColor: "var(--sabbi-lime)" } : undefined}
            >
              {KIND_TEXT[k].tab}
              {list !== null && (
                <span className="text-[11px] opacity-75">{activeRows(list).length}</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        id="entity-panel"
        role="tabpanel"
        aria-labelledby={`entity-tab-${kind}`}
        className="flex min-w-0 flex-col gap-3"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <EntityScoreSearch
            value={searchInput}
            onChange={setSearchInput}
            label={`Buscar ${text.plural}`}
            isLoading={isFetching || isDebouncing}
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-sabbi-neutral-600">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
            />
            Mostrar eliminados{all !== null ? ` (${deletedCount(all)})` : ""}
          </label>
        </div>

        {rows !== null && total !== null && !error && (
          <span className="text-xs text-sabbi-neutral-500">
            {rows.length} de {total}
          </span>
        )}

        <EntityScoreTable
          rows={rows}
          error={error}
          kind={kind}
          searching={term !== ""}
          onEdit={(row) => setModal({ type: "form", mode: "edit", entity: row })}
          onDelete={(row) => setModal({ type: "delete", entity: row })}
          onRestore={(row) => void handleRestore(row)}
          busyId={busyId}
        />
      </div>

      {modal?.type === "form" && (
        <EntityScoreFormModal
          key={`${kind}-${modal.entity?.id ?? "new"}`}
          kind={kind}
          mode={modal.mode}
          entity={modal.entity}
          rows={all ?? []}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          onGone={refresh}
        />
      )}
      {modal?.type === "delete" && (
        <EntityScoreDeleteModal
          kind={kind}
          entity={modal.entity}
          onClose={() => setModal(null)}
          onDeleted={handleDeleted}
          onGone={refresh}
        />
      )}
    </div>
  );
}
