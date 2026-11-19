"use client";

interface PropertySearchProps {
  value: string;
  onChange: (next: string) => void;
  isLoading?: boolean;
}

/** Search box of the properties list: text, a clear button and a "Buscando..." hint. */
export function PropertySearch({ value, onChange, isLoading = false }: PropertySearchProps) {
  return (
    <div className="relative w-full max-w-md">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <svg
          aria-hidden="true"
          className="h-4 w-4 text-sabbi-neutral-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        type="text"
        aria-label="Buscar propiedades"
        placeholder="Buscar por código, nombre o cliente..."
        className="block w-full rounded-md border border-sabbi-neutral-200 bg-sabbi-neutral-50 py-2 pr-10 pl-10 text-sabbi-neutral-900 transition-all placeholder:text-sabbi-neutral-400 focus:border-transparent focus:ring-2 focus:ring-sabbi-neutral-900 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {isLoading ? (
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <span className="animate-pulse text-[10px] font-medium text-sabbi-neutral-400">
            Buscando...
          </span>
        </div>
      ) : value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute inset-y-0 right-3 flex items-center"
          aria-label="Limpiar búsqueda"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-sabbi-neutral-400 hover:text-sabbi-neutral-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
