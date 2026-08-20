"use client";

import React from "react";
import { useUrlSearch } from "@/hooks/useUrlSearch";

  /**
   * Visual component for the search input in the administration panel.
   * Provides visual feedback (Searching...) and a button to clear the search.
   */
interface CatalogSearchProps {
  value: string;
  onChange: (next: string) => void;
  isLoading?: boolean;
}

export function CatalogSearch({ value, onChange, isLoading = false }: CatalogSearchProps) {
  return (
    <div className="relative w-full max-w-md">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg className="h-4 w-4 text-sabbi-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        placeholder="Buscar productos..."
        className="block w-full pl-10 pr-10 py-2 border border-sabbi-neutral-200 rounded-md bg-sabbi-neutral-50 text-sabbi-neutral-900 placeholder:text-sabbi-neutral-400 focus:outline-none focus:ring-2 focus:ring-sabbi-neutral-900 focus:border-transparent transition-all"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {isLoading ? (
        <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
          <span className="text-[10px] font-medium text-sabbi-neutral-400 animate-pulse">
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
          <svg className="h-4 w-4 text-sabbi-neutral-400 hover:text-sabbi-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}