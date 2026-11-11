"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  actionLabel,
  authorLabel,
  cascadeLabel,
  fieldLabel,
  formatChangeValue,
  formatLimaDateTime,
  groupCascades,
  levelLabel,
  limaDay,
  parseProductHistory,
  triggerLabel,
  type SyncEvent,
} from "@/lib/normalized-sync-events";
import { readApiError } from "./shared";

const BASE = "/api/admin/normalized-catalog";
const PAGE_SIZE = 10;
const LOAD_ERROR = "No se pudo cargar el historial";

export interface ProductHistoryState {
  events: SyncEvent[];
  /** How many events the product has in all; null until the first page loads. */
  total: number | null;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
}

/** The history of one product, newest first, `PAGE_SIZE` at a time. The first
 * page loads on its own so the section can say how many events there are. */
export function useProductHistory(code: string): ProductHistoryState {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        const res = await fetchWithAuth(
          `${BASE}/products/${encodeURIComponent(code)}/changes?${qs}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(await readApiError(res, LOAD_ERROR));
        const page = parseProductHistory(await res.json());
        if (!page) throw new Error(LOAD_ERROR);
        if (controller.signal.aborted) return;
        setTotal(page.total);
        setEvents((current) => {
          const known = new Set(current.map((e) => e.id));
          const next =
            offset === 0
              ? page.events
              : [...current, ...page.events.filter((e) => !known.has(e.id))];
          loadedRef.current = next.length;
          return next;
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : LOAD_ERROR);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [code],
  );

  useEffect(() => {
    setEvents([]);
    setTotal(null);
    loadedRef.current = 0;
    void fetchPage(0);
    return () => controllerRef.current?.abort();
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    void fetchPage(loadedRef.current);
  }, [fetchPage]);

  return { events, total, loading, error, loadMore };
}

// -- Event lines --------------------------------------------------------------

const ACTION_STYLE: Record<SyncEvent["action"], string> = {
  create: "bg-emerald-100 text-emerald-800",
  update: "bg-sky-100 text-sky-800",
  delete: "bg-red-100 text-red-700",
  restore: "bg-sabbi-neutral-100 text-sabbi-neutral-700",
};

function ChangeLines({ event }: { event: SyncEvent }) {
  if (event.changes.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs text-sabbi-neutral-700">
      {event.changes.map((c) => (
        <li key={c.field}>
          <span className="font-medium">{fieldLabel(c.field)}:</span>{" "}
          {event.action === "create"
            ? formatChangeValue(c.field, c.new)
            : `${formatChangeValue(c.field, c.old)} → ${formatChangeValue(c.field, c.new)}`}
        </li>
      ))}
    </ul>
  );
}

/** Who saved the workbook. A name is a violet tag after a gray "por"; "Desconocido" is
 * an amber tag like the observations, because it may mean someone edited without
 * a corporate account. Nothing when there is no data. */
function Author({ changedBy }: { changedBy: string | null | undefined }) {
  const author = authorLabel(changedBy);
  if (!author) return null;
  if (author.kind === "unknown") {
    return (
      <span
        title="No se pudo determinar quién guardó el archivo"
        className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-amber-800 uppercase"
      >
        {author.text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-sabbi-neutral-500">
      por{" "}
      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-violet-800">
        {author.text}
      </span>
    </span>
  );
}

function EventItem({
  event,
  cascade,
  highlighted,
}: {
  event: SyncEvent;
  cascade: SyncEvent[];
  highlighted: boolean;
}) {
  return (
    <li
      data-highlighted={highlighted ? "true" : undefined}
      className={`rounded-lg border px-3 py-2 ${
        highlighted
          ? "border-sabbi-primary bg-[#f0fcd4]"
          : "border-sabbi-neutral-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs tabular-nums text-sabbi-neutral-600">
          {formatLimaDateTime(event.occurred_at)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap uppercase ${ACTION_STYLE[event.action]}`}
        >
          {actionLabel(event.action)}
        </span>
        <span className="text-xs text-sabbi-neutral-900">{levelLabel(event)}</span>
        <span className="text-[11px] text-sabbi-neutral-400">
          {triggerLabel(event.trigger)}
        </span>
        <Author changedBy={event.changed_by} />
      </div>
      <ChangeLines event={event} />
      {cascade.length > 0 && (
        <details className="mt-1 text-xs text-sabbi-neutral-700">
          <summary className="cursor-pointer text-sabbi-neutral-600">
            Se eliminó junto con {cascadeLabel(cascade)}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-3">
            {cascade.map((child) => (
              <li key={child.id}>{levelLabel(child)}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** The events of a product as lines. `highlightDay` (`YYYY-MM-DD`, Lima) marks
 * the ones that happened that day. */
export function EventList({
  events,
  highlightDay,
}: {
  events: readonly SyncEvent[];
  highlightDay: string | null;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {groupCascades(events).map(({ event, children }) => (
        <EventItem
          key={event.id}
          event={event}
          cascade={children}
          highlighted={
            highlightDay !== null && limaDay(event.occurred_at) === highlightDay
          }
        />
      ))}
    </ul>
  );
}

/** Loading, empty and error states, the lines, and "Ver más". */
export function HistoryBody({
  history,
  highlightDay,
}: {
  history: ProductHistoryState;
  highlightDay: string | null;
}) {
  const { events, total, loading, error, loadMore } = history;
  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && loading && events.length === 0 && (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      )}
      {!error && !loading && total === 0 && (
        <p className="text-sm text-sabbi-neutral-600">
          Este producto aún no tiene cambios registrados.
        </p>
      )}
      {events.length > 0 && (
        <EventList events={events} highlightDay={highlightDay} />
      )}
      {total !== null && events.length < total && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="w-fit rounded-md px-2 py-1 text-xs font-medium text-sabbi-primary hover:bg-sabbi-neutral-50 disabled:opacity-50"
        >
          Ver más
        </button>
      )}
    </div>
  );
}

// -- Section of the product detail --------------------------------------------

/** Collapsible "Historial (N)" of the product detail. Collapsed by default,
 * except when a day is highlighted (the filter of changed products is on). */
export default function ProductHistory({
  code,
  highlightDay,
}: {
  code: string;
  highlightDay: string | null;
}) {
  const history = useProductHistory(code);
  const [open, setOpen] = useState(highlightDay !== null);

  useEffect(() => {
    if (highlightDay !== null) setOpen(true);
  }, [highlightDay]);

  return (
    <section className="rounded-xl border border-sabbi-neutral-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-sabbi-neutral-900">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 text-left"
        >
          <span aria-hidden="true" className="text-xs text-sabbi-neutral-500">
            {open ? "▾" : "▸"}
          </span>
          {history.total === null
            ? "Historial"
            : `Historial (${history.total})`}
        </button>
      </h3>
      {history.error && !open && (
        <p className="mt-2 text-sm text-red-600">{history.error}</p>
      )}
      {open && (
        <div className="mt-3">
          <HistoryBody history={history} highlightDay={highlightDay} />
        </div>
      )}
    </section>
  );
}
