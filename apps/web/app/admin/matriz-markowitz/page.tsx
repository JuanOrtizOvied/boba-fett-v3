"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import { MarkowitzHeatmap } from "@/components/admin/markowitz/MarkowitzHeatmap";
import { MarkowitzReviewList } from "@/components/admin/markowitz/MarkowitzReviewList";
import {
  getMarkowitzMatrix,
  tabFromParam,
  tabToParam,
  type MarkowitzMatrix,
  type MatrixTab,
} from "@/lib/markowitz";

const TABS: readonly { id: MatrixTab; label: string }[] = [
  { id: "matrix", label: "Matriz" },
  { id: "review", label: "Por revisar" },
];

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export default function MarkowitzPage() {
  // useUrlSearch -> useSearchParams requires a <Suspense> boundary in App Router.
  return (
    <Suspense fallback={<p className="text-sm text-sabbi-neutral-600">Cargando…</p>}>
      <MarkowitzContent />
    </Suspense>
  );
}

function MarkowitzContent() {
  const [tabParam, setTabParam] = useUrlSearch("tab");
  const tab = tabFromParam(tabParam);

  const [matrix, setMatrix] = useState<MarkowitzMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the retry button (and, later, after every write).
  const [reload, setReload] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setError(null);
    try {
      const result = await getMarkowitzMatrix(signal);
      if (!signal.aborted) setMatrix(result);
    } catch (err) {
      if (signal.aborted || isAbort(err)) return;
      setError(err instanceof Error && err.message ? err.message : "No se pudo cargar la matriz");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reload]);

  const reviewCount = matrix?.review.length ?? null;

  let content: ReactNode;
  if (matrix === null) {
    content = error ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600">
        <span>{error}</span>
        <button
          type="button"
          onClick={() => setReload((n) => n + 1)}
          className="rounded-lg border border-red-200 px-3 py-1.5 font-medium hover:bg-red-50"
        >
          Reintentar
        </button>
      </div>
    ) : (
      <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
    );
  } else if (matrix.assets.length === 0) {
    content = (
      <p className="rounded-xl border border-sabbi-neutral-200 bg-white px-4 py-6 text-sm text-sabbi-neutral-600">
        La matriz aún no está cargada.
      </p>
    );
  } else if (tab === "matrix") {
    content = (
      <>
        <span className="text-xs text-sabbi-neutral-500">
          {matrix.assets.length} activos. La fila frente a la columna: pasa el puntero o usa las
          flechas para ver la pareja.
        </span>
        <MarkowitzHeatmap matrix={matrix} />
      </>
    );
  } else {
    content = <MarkowitzReviewList assets={matrix.assets} review={matrix.review} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">Matriz de Markowitz</h1>
      </div>

      <p
        role="note"
        className="max-w-3xl rounded-lg border border-sabbi-neutral-200 bg-white px-3 py-2 text-sm text-sabbi-neutral-600"
      >
        Es la matriz de correlaciones entre clases de activo que usa el cálculo de riesgo
        estructural. Los cambios guardados aquí todavía no modifican ningún puntaje: el cálculo
        sigue usando su propia copia de la matriz hasta que se conecte con esta.
      </p>

      <div
        role="tablist"
        aria-label="Vista"
        className="flex w-fit overflow-hidden rounded-lg border border-sabbi-neutral-200 bg-white"
      >
        {TABS.map((t, index) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              id={`markowitz-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="markowitz-panel"
              onClick={() => setTabParam(tabToParam(t.id))}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium transition-colors ${
                index > 0 ? "border-l border-sabbi-neutral-200" : ""
              } ${selected ? "text-sabbi-neutral-900" : "text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"}`}
              style={selected ? { backgroundColor: "var(--sabbi-lime)" } : undefined}
            >
              {t.label}
              {t.id === "review" && reviewCount !== null && (
                <span
                  data-testid="review-count"
                  className="rounded-full bg-sabbi-gold px-1.5 text-[11px] font-bold text-sabbi-neutral-900"
                >
                  {reviewCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        id="markowitz-panel"
        role="tabpanel"
        aria-labelledby={`markowitz-tab-${tab}`}
        className="flex min-w-0 flex-col gap-3"
      >
        {content}
        {error && matrix !== null && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
