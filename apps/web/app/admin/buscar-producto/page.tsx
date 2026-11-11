"use client";

import { useState } from "react";
import ProductLookupForm from "@/components/admin/ProductLookupForm";
import { lookupProduct } from "@/lib/catalogLookupApi";
import type { SearchResult } from "@/lib/portfolio-types";

type Status = "idle" | "loading" | "done";

export default function BuscarProductoPage() {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const query = name.trim();
    if (!query) return;
    setStatus("loading");
    setError(null);
    setResult(null);
    try {
      const found = await lookupProduct(query);
      setResult(found);
      setStatus("done");
    } catch {
      setError("No se pudo buscar el producto. Intentá de nuevo.");
      setStatus("idle");
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">Buscar producto</h1>
        <p className="mt-1 text-sm text-sabbi-neutral-600">
          Busca un producto por su nombre: primero en el catálogo y, si no lo encuentra, en la
          web con Claude.
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="product-name" className="text-xs font-medium text-sabbi-neutral-700">
            Nombre del producto
          </label>
          <input
            id="product-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Credicorp Crecimiento VCS"
            className="rounded-lg border border-sabbi-neutral-200 px-3 py-2 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary"
          />
        </div>
        <button
          type="submit"
          disabled={status === "loading" || name.trim() === ""}
          className="rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "loading" ? "Buscando…" : "Buscar"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {status === "done" && result && <ProductLookupForm result={result} />}

      {status === "done" && result === null && (
        <p className="rounded-lg border border-sabbi-neutral-200 bg-sabbi-neutral-50 px-3 py-2 text-sm text-sabbi-neutral-600">
          No se encontró ningún producto con ese nombre, ni en el catálogo ni en la web.
        </p>
      )}
    </div>
  );
}
