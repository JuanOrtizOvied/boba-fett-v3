"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { PORTFOLIO_REFETCH_EVENT } from "@/lib/portfolioEvents";
import type { Product } from "@/lib/portfolio-types";

/** Mirrors `db.versioning.VersioningRepository.create_snapshot`/`list_snapshots`. */
export interface Snapshot {
  id: string;
  name: string;
  description: string;
  product_count: number;
  total_amount: number;
  created_at: string;
}

/** A snapshot's full detail payload — `GET /portfolio/me/snapshots/:id`. */
export interface SnapshotDetail extends Snapshot {
  products: Product[];
}

/** Before/after value pair for one changed field in a `modified` diff entry. */
export interface SnapshotDiffFieldDelta {
  before: unknown;
  after: unknown;
}

/**
 * One `modified` entry from `GET /portfolio/me/compare`. Mirrors
 * `VersioningRepository.compare_snapshots`'s actual return shape — `before`/
 * `after` are the full materialized products (not just `name`), and each
 * `changes` entry uses `{before, after}` keys (not `{from, to}` as
 * `design.md`'s stale sketch shows).
 */
export interface SnapshotDiffModifiedEntry {
  product_id: string;
  name: string;
  before: Product;
  after: Product;
  changes: Record<string, SnapshotDiffFieldDelta>;
}

export interface SnapshotDiffSummary {
  added_count: number;
  removed_count: number;
  modified_count: number;
  total_amount_delta: number;
  product_count_delta: number;
}

/** `GET /portfolio/me/compare?a=:id&b=:id` response — `versioning.py::compare_snapshots`. */
export interface SnapshotDiff {
  snapshot_a: string;
  snapshot_b: string;
  added: Product[];
  removed: Product[];
  modified: SnapshotDiffModifiedEntry[];
  summary: SnapshotDiffSummary;
}

export type ChangeOperation = "create" | "update" | "delete";
export type ChangeSource = "agent" | "api" | "admin";

/** One `portfolio_changes` row — `GET /portfolio/me/changes`. */
export interface ChangeLogEntry {
  id: string;
  user_id: string;
  product_id: string | null;
  operation: ChangeOperation;
  before_state: Product | null;
  after_state: Product | null;
  source: ChangeSource;
  metadata: Record<string, unknown>;
  snapshot_id: string | null;
  created_at: string;
}

export interface FetchChangesOptions {
  limit?: number;
  offset?: number;
}

export interface UsePortfolioVersioningResult {
  // Snapshots
  snapshots: Snapshot[];
  isLoadingSnapshots: boolean;
  fetchSnapshots: () => Promise<void>;
  createSnapshot: (name: string, description?: string) => Promise<Snapshot>;

  // Comparison
  comparison: SnapshotDiff | null;
  isComparing: boolean;
  /** Set when the last `compareSnapshots` call failed — CMP-005. */
  compareError: string | null;
  compareSnapshots: (aId: string, bId: string) => Promise<void>;
  clearComparison: () => void;

  // Change log
  changes: ChangeLogEntry[];
  isLoadingChanges: boolean;
  changesTotal: number;
  changesHasMore: boolean;
  fetchChanges: (opts?: FetchChangesOptions) => Promise<void>;
}

/** Extracts FastAPI's `{"detail": "..."}` error body, if present. */
async function readErrorDetail(res: Response): Promise<string | null> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object" && "detail" in data) {
      const detail = (data as { detail?: unknown }).detail;
      return typeof detail === "string" ? detail : null;
    }
  } catch {
    // Response body wasn't JSON — fall through to the generic message.
  }
  return null;
}

/**
 * Frontend data layer for portfolio versioning. Follows `usePortfolio.ts`'s
 * conventions: `fetchWithAuth`, `useCallback`/`useState`, redirect to
 * `/login` on `401`. `design.md` → "Frontend Architecture" → "Data Layer".
 *
 * PR6 (T-020) shipped the snapshot slice. PR7 (T-024) adds the comparison
 * and change-log slices, matching the actually-implemented backend response
 * shapes in `db/versioning.py`/`api/routes.py` rather than `design.md`'s
 * earlier sketch (e.g. `list_changes` returns `{changes, total, has_more}`,
 * not a bare list; `compare_snapshots`'s per-field deltas use
 * `{before, after}` keys, not `{from, to}`).
 *
 * Per the SNAP-009 deviation flagged in tasks.md (PR6 section): creating a
 * snapshot of an empty portfolio is a supported, non-error backend behavior
 * — this hook does not special-case `productCount === 0`, and callers must
 * not disable snapshot creation on an empty portfolio.
 */
export function usePortfolioVersioning(): UsePortfolioVersioningResult {
  const router = useRouter();

  // Snapshots
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(true);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/portfolio/me/snapshots");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error(`Failed to load snapshots (${res.status})`);
      const data: { snapshots: Snapshot[] } = await res.json();
      setSnapshots(data.snapshots ?? []);
    } finally {
      setIsLoadingSnapshots(false);
    }
  }, [router]);

  useEffect(() => {
    void fetchSnapshots();
  }, [fetchSnapshots]);

  const createSnapshot = useCallback(
    async (name: string, description = ""): Promise<Snapshot> => {
      const res = await fetchWithAuth("/api/portfolio/me/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (res.status === 401) {
        router.push("/login");
        throw new Error("Unauthorized");
      }
      if (!res.ok) throw new Error(`No se pudo guardar la versión (status ${res.status})`);
      const snapshot: Snapshot = await res.json();
      // Matches `usePortfolio`'s refetch-after-mutation convention — no
      // cross-hook event needed since snapshot creation doesn't touch
      // product data (design.md → "State Management").
      await fetchSnapshots();
      return snapshot;
    },
    [fetchSnapshots, router],
  );

  // Comparison
  const [comparison, setComparison] = useState<SnapshotDiff | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const compareSnapshots = useCallback(
    async (aId: string, bId: string) => {
      setIsComparing(true);
      setCompareError(null);
      try {
        const params = new URLSearchParams({ a: aId, b: bId });
        const res = await fetchWithAuth(`/api/portfolio/me/compare?${params.toString()}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          const detail = await readErrorDetail(res);
          throw new Error(detail ?? `No se pudo comparar las versiones (status ${res.status})`);
        }
        const diff: SnapshotDiff = await res.json();
        setComparison(diff);
      } catch (err) {
        // CMP-005: surface a distinguishable error, never leave `comparison`
        // in a stale or partial state from a previous successful compare.
        setComparison(null);
        setCompareError(
          err instanceof Error ? err.message : "No se pudo comparar las versiones",
        );
      } finally {
        setIsComparing(false);
      }
    },
    [router],
  );

  const clearComparison = useCallback(() => {
    setComparison(null);
    setCompareError(null);
  }, []);

  // Change log
  const [changes, setChanges] = useState<ChangeLogEntry[]>([]);
  const [isLoadingChanges, setIsLoadingChanges] = useState(true);
  const [changesTotal, setChangesTotal] = useState(0);
  const [changesHasMore, setChangesHasMore] = useState(false);

  const fetchChanges = useCallback(
    async (opts?: FetchChangesOptions) => {
      setIsLoadingChanges(true);
      try {
        const params = new URLSearchParams();
        if (opts?.limit != null) params.set("limit", String(opts.limit));
        if (opts?.offset != null) params.set("offset", String(opts.offset));
        const qs = params.toString();
        const res = await fetchWithAuth(`/api/portfolio/me/changes${qs ? `?${qs}` : ""}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok)
          throw new Error(`No se pudo cargar el historial de cambios (status ${res.status})`);
        const data: { changes: ChangeLogEntry[]; total: number; has_more: boolean } =
          await res.json();
        setChanges(data.changes ?? []);
        setChangesTotal(data.total ?? 0);
        setChangesHasMore(data.has_more ?? false);
      } finally {
        setIsLoadingChanges(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void fetchChanges();
  }, [fetchChanges]);

  useEffect(() => {
    // AL-008: keep the change log (and `VersioningBar`'s recent-activity
    // indicator) fresh after a chat-stream-triggered portfolio mutation,
    // reusing `usePortfolio.ts`'s existing refetch-event bridge instead of
    // inventing a new one.
    const handleRefetchEvent = () => {
      void fetchChanges();
    };
    window.addEventListener(PORTFOLIO_REFETCH_EVENT, handleRefetchEvent);
    return () => window.removeEventListener(PORTFOLIO_REFETCH_EVENT, handleRefetchEvent);
  }, [fetchChanges]);

  return {
    snapshots,
    isLoadingSnapshots,
    fetchSnapshots,
    createSnapshot,

    comparison,
    isComparing,
    compareError,
    compareSnapshots,
    clearComparison,

    changes,
    isLoadingChanges,
    changesTotal,
    changesHasMore,
    fetchChanges,
  };
}
