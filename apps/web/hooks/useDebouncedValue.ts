"use client";

import { useState, useEffect } from "react";

  /**
   * Hook to delay the update of a value.
   * Useful for avoiding excessive executions of functions (such as API requests)
   * while the user types in an input.
   * 
   * @param value The value to observe.
   * @param delay The wait time in milliseconds (e.g., 300 for search).
   * @returns The delayed value.
   */
export function useDebouncedValue<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue; // Solo devuelve el valor debounced
}