"use client";

import { Suspense, useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import { EntityScoreSearch } from "@/components/admin/entity-scores/EntityScoreSearch";
import { EntityScoreTable } from "@/components/admin/entity-scores/EntityScoreTable";
import {
  ENTITY_KINDS,
  KIND_TEXT,
  SEARCH_PARAM,
  activeRows,
  deletedCount,
  listEntityScores,
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

type Lists = Record<EntityKind, EntityScore[] | null>;
type Errors = Record<EntityKind, string | null>;

export default function EntityScoresPage() {
  // useUrlSearch -> useSearchParams requires a <Suspense> boundary in App Router.
  return (
    <Suspense fallback={<p className="text-sm text-sabbi-neutral-600">Cargando…</p>}>
      <EntityScoresContent />
    </Suspense>
  );
}

function EntityScoresContent() {
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

  useEffect(() => {
    const controller = new AbortController();
    for (const k of ENTITY_KINDS) {
      listEntityScores(k, { includeDeleted: true, signal: controller.signal })
        .then((rows) => {
          if (controller.signal.aborted) return;
          setLists((prev) => ({ ...prev, [k]: rows }));
          setListErrors((prev) => ({ ...prev, [k]: null }));
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || isAbort(err)) return;
          setListErrors((prev) => ({
            ...prev,
            [k]: message(err, `No se pudieron cargar los ${KIND_TEXT[k].plural}`),
          }));
        });
    }
    return () => controller.abort();
  }, []);

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
  }, [kind, term, showDeleted]);

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
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Administradores y gestores</h1>

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

        <EntityScoreTable rows={rows} error={error} kind={kind} searching={term !== ""} />
      </div>
    </div>
  );
}
