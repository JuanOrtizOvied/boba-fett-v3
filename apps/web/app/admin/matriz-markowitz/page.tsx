"use client";

import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { useUrlSearch } from "@/hooks/useUrlSearch";
import { useToast } from "@/components/ui/Toast";
import { MarkowitzAssetModal } from "@/components/admin/markowitz/MarkowitzAssetModal";
import { MarkowitzCellModal } from "@/components/admin/markowitz/MarkowitzCellModal";
import { MarkowitzHeatmap } from "@/components/admin/markowitz/MarkowitzHeatmap";
import { MarkowitzNewAssetModal } from "@/components/admin/markowitz/MarkowitzNewAssetModal";
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

// The modals name assets by id, not by position, so a matrix read again while one is open
// still points at the same assets.
type ModalState =
  | { type: "cell"; rowId: number; colId: number }
  | { type: "asset"; id: number }
  | { type: "new" }
  | null;

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
  const { toast } = useToast();
  const [tabParam, setTabParam] = useUrlSearch("tab");
  const tab = tabFromParam(tabParam);

  const [matrix, setMatrix] = useState<MarkowitzMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the retry button and after every write, to read the matrix again.
  const [reload, setReload] = useState(0);
  const [modal, setModal] = useState<ModalState>(null);

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

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const closeModal = useCallback(() => setModal(null), []);

  const gone = (message: string) => {
    refresh();
    toast(message);
  };

  const done = (message: string) => {
    setModal(null);
    refresh();
    toast(message, "success");
  };

  const reviewCount = matrix?.review.length ?? null;
  const loaded = matrix !== null && matrix.assets.length > 0;

  let content: ReactNode;
  if (matrix === null) {
    content = error ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600">
        <span>{error}</span>
        <button
          type="button"
          onClick={refresh}
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
          flechas para ver la pareja. Haz clic en una celda para editarla, o en un nombre para
          editar el activo.
        </span>
        <MarkowitzHeatmap
          matrix={matrix}
          onCellActivate={(r, c) =>
            setModal({ type: "cell", rowId: matrix.assets[r].id, colId: matrix.assets[c].id })
          }
          onAssetActivate={(i) => setModal({ type: "asset", id: matrix.assets[i].id })}
        />
      </>
    );
  } else {
    content = (
      <MarkowitzReviewList
        assets={matrix.assets}
        review={matrix.review}
        onOpen={(pair) => setModal({ type: "cell", rowId: pair.a_id, colId: pair.b_id })}
      />
    );
  }

  // The open modal, resolved against the matrix on screen. If its asset is gone the modal
  // is simply not drawn.
  let modalView: ReactNode = null;
  if (matrix !== null && modal !== null) {
    if (modal.type === "cell") {
      const rowIndex = matrix.assets.findIndex((a) => a.id === modal.rowId);
      const colIndex = matrix.assets.findIndex((a) => a.id === modal.colId);
      if (rowIndex >= 0 && colIndex >= 0 && rowIndex !== colIndex) {
        modalView = (
          <MarkowitzCellModal
            key={`cell-${modal.rowId}-${modal.colId}`}
            matrix={matrix}
            rowIndex={rowIndex}
            colIndex={colIndex}
            onClose={closeModal}
            onSaved={() => done("Correlación guardada")}
            onGone={gone}
          />
        );
      }
    } else if (modal.type === "asset") {
      const asset = matrix.assets.find((a) => a.id === modal.id);
      if (asset) {
        modalView = (
          <MarkowitzAssetModal
            key={`asset-${asset.id}`}
            asset={asset}
            assets={matrix.assets}
            onClose={closeModal}
            onSaved={() => done("Activo guardado")}
            onGone={gone}
          />
        );
      }
    } else if (loaded) {
      modalView = (
        <MarkowitzNewAssetModal
          key="new-asset"
          matrix={matrix}
          onClose={closeModal}
          onSaved={() => done("Activo creado")}
          onStale={refresh}
        />
      );
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">Matriz de Markowitz</h1>
        <button
          type="button"
          onClick={() => setModal({ type: "new" })}
          disabled={!loaded}
          className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-50"
        >
          + Nuevo activo
        </button>
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

      {modalView}
    </div>
  );
}
