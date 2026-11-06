import type { FichaListItem, FichaStatus } from "@/lib/portfolio-types";

export type FichaFilter = FichaStatus | "todas";

const FILTER_TABS: { key: FichaFilter; label: string }[] = [
  { key: "por_validar", label: "Por validar" },
  { key: "en_proceso", label: "En proceso" },
  { key: "validada", label: "Validadas" },
  { key: "con_error", label: "Con error" },
  { key: "todas", label: "Todas" },
];

const STATUS_BADGES: Record<FichaStatus, { label: string; className: string }> = {
  por_validar: {
    label: "Por validar",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  en_proceso: {
    label: "En proceso",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  validada: {
    label: "Validada",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  con_error: {
    label: "Con error",
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

interface FichaSidebarProps {
  fichas: FichaListItem[];
  activeFilter: FichaFilter;
  selectedId: number | null;
  onFilterChange: (filter: FichaFilter) => void;
  onSelect: (id: number) => void;
  onUpload: () => void;
  onDelete: (id: number) => void;
  onDownload: (id: number) => void;
}

export default function FichaSidebar({
  fichas,
  activeFilter,
  selectedId,
  onFilterChange,
  onSelect,
  onUpload,
  onDelete,
  onDownload,
}: FichaSidebarProps) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 border-r border-sabbi-neutral-200 pr-3">
      <div>
        <h2 className="text-sm font-semibold text-sabbi-neutral-900">
          Fichas patrimoniales
        </h2>
        <p className="text-xs text-sabbi-neutral-500">
          Validación de productos para la BD Sabbi
        </p>
      </div>

      <button
        type="button"
        onClick={onUpload}
        className="rounded-lg bg-sabbi-primary px-3 py-2 text-sm font-medium text-white hover:bg-sabbi-primary-hover"
      >
        Subir ficha (.xlsx)
      </button>

      <div className="flex flex-wrap gap-1.5">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onFilterChange(tab.key)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              activeFilter === tab.key
                ? "bg-sabbi-neutral-900 text-white"
                : "bg-sabbi-neutral-100 text-sabbi-neutral-600 hover:bg-sabbi-neutral-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto">
        {fichas.length === 0 && (
          <p className="text-xs text-sabbi-neutral-400">Sin fichas.</p>
        )}
        {fichas.map((ficha) => {
          const badge = STATUS_BADGES[ficha.status];
          const isSelected = ficha.id === selectedId;
          const label = ficha.client_name || ficha.client_email || `ficha ${ficha.id}`;
          return (
            <div key={ficha.id} className="relative">
              <button
                type="button"
                data-testid={`ficha-row-${ficha.id}`}
                aria-current={isSelected ? "true" : undefined}
                onClick={() => onSelect(ficha.id)}
                className={`flex w-full flex-col gap-1 rounded-lg border p-2.5 pr-14 text-left ${
                  isSelected
                    ? "border-sabbi-primary bg-sabbi-primary/5"
                    : "border-sabbi-neutral-200 hover:bg-sabbi-neutral-50"
                }`}
              >
                <span className="text-sm font-medium text-sabbi-neutral-900">
                  {ficha.client_name || ficha.client_email || "—"}
                </span>
                <span className="text-xs text-sabbi-neutral-500">
                  {ficha.line_count} producto{ficha.line_count === 1 ? "" : "s"}
                  {ficha.created_at ? ` · ${formatDate(ficha.created_at)}` : ""}
                </span>
                <span
                  className={`self-start rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Descargar Excel de ${label}`}
                title="Descargar el Excel original"
                onClick={() => onDownload(ficha.id)}
                className="absolute right-9 top-2 rounded p-1 text-sabbi-neutral-400 hover:bg-sabbi-primary/10 hover:text-sabbi-primary"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`Eliminar ${label}`}
                onClick={() => onDelete(ficha.id)}
                className="absolute right-2 top-2 rounded p-1 text-sabbi-neutral-400 hover:bg-red-50 hover:text-red-500"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
