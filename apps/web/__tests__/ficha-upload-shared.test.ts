import { describe, expect, test } from "vitest";
import {
  extractBase64Payload,
  extractErrorDetail,
  formatFileSize,
  validateFichaFile,
} from "@/components/admin/ficha-patrimonial/fichaUploadShared";

function makeFile(name: string, sizeBytes: number, type = ""): File {
  const file = new File([new Uint8Array(Math.max(sizeBytes, 0))], name, {
    type,
  });
  // jsdom's File already derives `size` from the blob parts, but be explicit
  // in case a future jsdom version changes that.
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("validateFichaFile", () => {
  test("accepts a .xlsx file under the 10MB limit", () => {
    const file = makeFile("ficha.xlsx", 2 * 1024 * 1024);
    expect(validateFichaFile(file)).toBeNull();
  });

  test("rejects a non-.xlsx file with an actionable message", () => {
    const file = makeFile("ficha.csv", 1024);
    expect(validateFichaFile(file)).toBe("Solo se admiten archivos .xlsx");
  });

  test("rejects a file over the 10MB limit", () => {
    const file = makeFile("ficha.xlsx", 11 * 1024 * 1024);
    expect(validateFichaFile(file)).toBe(
      "El archivo supera el tamaño máximo permitido (10.0 MB)",
    );
  });
});

describe("formatFileSize", () => {
  test("formats sub-kilobyte sizes in bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  test("formats kilobyte-range sizes with one decimal", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  test("formats megabyte-range sizes with one decimal", () => {
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

describe("extractBase64Payload", () => {
  test("strips the data-URL prefix, keeping only the base64 payload", () => {
    expect(
      extractBase64Payload(
        "data:application/vnd.openxmlformats;base64,AAAA",
      ),
    ).toBe("AAAA");
  });

  test("returns the input unchanged when there is no comma prefix", () => {
    expect(extractBase64Payload("AAAA")).toBe("AAAA");
  });
});

describe("extractErrorDetail", () => {
  test("returns a string detail verbatim", () => {
    expect(
      extractErrorDetail({ detail: "Usuario no encontrado" }, "fallback"),
    ).toBe("Usuario no encontrado");
  });

  test("joins Pydantic-style validation-error arrays by their msg field", () => {
    expect(
      extractErrorDetail(
        {
          detail: [
            { msg: "El monto debe ser mayor a 0" },
            { msg: "La clase de activo es obligatoria" },
          ],
        },
        "fallback",
      ),
    ).toBe("El monto debe ser mayor a 0; La clase de activo es obligatoria");
  });

  test("falls back to the default message when there is no detail field", () => {
    expect(extractErrorDetail({}, "No se pudo confirmar")).toBe(
      "No se pudo confirmar",
    );
  });

  test("falls back to the default message for a non-object body", () => {
    expect(extractErrorDetail(null, "No se pudo confirmar")).toBe(
      "No se pudo confirmar",
    );
  });
});
