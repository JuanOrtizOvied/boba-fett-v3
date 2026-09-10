/**
 * Pure helpers for the Ficha Patrimonial upload flow. Kept side-effect-free
 * (except `readFileAsBase64`, the one browser API call) so validation and
 * formatting logic is directly unit-testable without mounting `UploadZone`.
 * Mirrors the `catalogFormShared.ts` pattern used by the catalog admin page.
 */

const XLSX_EXTENSION = ".xlsx";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — spec: "Ficha Upload Page"

/**
 * Validates a selected file against the ficha upload constraints (`.xlsx`
 * only, max 10MB). Returns a user-facing error message, or `null` when the
 * file is acceptable.
 */
export function validateFichaFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(XLSX_EXTENSION)) {
    return "Solo se admiten archivos .xlsx";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `El archivo supera el tamaño máximo permitido (${formatFileSize(MAX_FILE_SIZE_BYTES)})`;
  }
  return null;
}

/** Formats a byte count as a short human-readable size (B / KB / MB). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Strips the `data:<mime>;base64,` prefix from a `FileReader.readAsDataURL()`
 * result, leaving only the payload the backend's `base64.b64decode()`
 * expects (`FichaParseRequest.file_data`).
 */
export function extractBase64Payload(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
}

/** Reads a `File` as a base64 data URL, matching `thread.tsx`'s `readFileAsDataUrl`. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts a user-facing message from a failed fetch response body. FastAPI
 * returns either a plain string `detail` (`HTTPException` calls) or an array
 * of Pydantic validation errors (422s) — normalize both to text. Shared by
 * `page.tsx`'s parse-error handling and `ReviewTable`'s confirm-error
 * handling so the two don't drift (mirrors `EditCatalogModal`'s inline
 * version in `admin/catalog/page.tsx`).
 */
export function extractErrorDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object" || !("detail" in body)) return fallback;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === "string" && detail.trim() !== "") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) =>
        d && typeof d === "object" && "msg" in d
          ? String((d as { msg: unknown }).msg)
          : JSON.stringify(d),
      )
      .join("; ");
  }
  return fallback;
}
