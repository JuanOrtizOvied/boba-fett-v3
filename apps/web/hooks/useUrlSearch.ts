import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useState, useCallback, useEffect } from 'react';

  /**
   * Hook to synchronize a search parameter from the URL with a local state.
   * Allows the search to be persistent on page refresh or navigation.
   * 
   * @param key The name of the parameter in the URL (e.g., 'search').
   * @returns A pair [current_value, update_function].
   * @example 
   * const [searchValue, setSearchValue] = useUrlSearch("search");
   */
export function useUrlSearch(key: string = "search") {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [value, setValue] = useState(() => searchParams.get(key) ?? "");

  // Sincroniza cuando la URL cambia externamente (atrás/adelante)
  const urlValue = searchParams.get(key) ?? "";
  useEffect(() => {
    setValue((prev) => (prev === urlValue ? prev : urlValue));
  }, [urlValue]);

  const updateValue = useCallback(
    (newValue: string) => {
      setValue(newValue);
      const params = new URLSearchParams(searchParams.toString());
      if (newValue.trim() === "") {
        params.delete(key);
      } else {
        params.set(key, newValue);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [key, pathname, router, searchParams],
  );

  return [value, updateValue] as const;
}