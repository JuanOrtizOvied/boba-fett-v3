import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  approveFichaLine,
  confirmFicha,
  downloadFichaFile,
  filenameFromDisposition,
  getCatalogHistory,
  deleteFicha,
  fichaToEnrichedRows,
  getFicha,
  getCatalogProductAsSearchResult,
  listFichas,
  researchFichaLine,
  searchCatalogProducts,
  updateLineStatus,
} from "@/lib/fichaApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { Ficha } from "@/lib/portfolio-types";

vi.mock("@/lib/fetchWithAuth", () => ({ fetchWithAuth: vi.fn() }));

function okJson(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

beforeEach(() => vi.mocked(fetchWithAuth).mockReset());

describe("fichaApi", () => {
  test("listFichas without a status filter", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson([{ id: 1, client_name: "Ana", status: "por_validar" }]),
    );
    const items = await listFichas();
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/ficha-patrimonial/fichas",
    );
    expect(items[0].id).toBe(1);
  });

  test("searchCatalogProducts hits the normalized-catalog list endpoint", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson([{ code: "BD-00352", name: "KKR Infra" }]),
    );
    const rows = await searchCatalogProducts("KKR Infra");
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/normalized-catalog/products?search=KKR%20Infra",
    );
    expect(rows[0].code).toBe("BD-00352");
  });

  test("getCatalogProductAsSearchResult fetches one product by code", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson({ name: "KKR Infra Fund", catalog_product_code: "BD-00352" }),
    );
    const result = await getCatalogProductAsSearchResult("BD-00352");
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/ficha-patrimonial/catalog-product/BD-00352",
    );
    expect(result.catalog_product_code).toBe("BD-00352");
  });

  test("listFichas with a status filter", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(okJson([]));
    await listFichas("validada");
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/ficha-patrimonial/fichas?status=validada",
    );
  });

  test("getFicha fetches one ficha by id", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson({ id: 5, status: "en_proceso", lines: [] }),
    );
    const ficha = await getFicha(5);
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/ficha-patrimonial/fichas/5",
    );
    expect(ficha.id).toBe(5);
  });

  test("updateLineStatus PATCHes the line status", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(okJson({ ok: true }));
    await updateLineStatus(9, "approved");
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/ficha-patrimonial/lines/9");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "approved",
    });
  });

  test("confirmFicha POSTs to the confirm endpoint", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(okJson({ ok: true }));
    await confirmFicha(7);
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/ficha-patrimonial/fichas/7/confirm");
    expect((init as RequestInit).method).toBe("POST");
  });

  test("getCatalogHistory fetches a product's change history", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson([{ id: 1, product_code: "BD-1", action: "update" }]),
    );
    const history = await getCatalogHistory("BD-1");
    expect(fetchWithAuth).toHaveBeenCalledWith(
      "/api/admin/catalog/products/BD-1/history",
    );
    expect(history[0].action).toBe("update");
  });

  test("approveFichaLine POSTs the approve payload", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson({ catalog_product_code: "BD-1", catalog_changes: {} }),
    );
    await approveFichaLine({
      user_id: "u1",
      product: {},
      catalog_product_code: "BD-1",
      catalog_update: {},
      series: [],
      admins: [],
    });
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/ficha-patrimonial/approve");
    expect((init as RequestInit).method).toBe("POST");
  });

  test("researchFichaLine POSTs the product name to the research endpoint", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson({ name: "Credicorp VCS", manager: "Credicorp" }),
    );
    const result = await researchFichaLine("Credicorp Crecimiento");
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/ficha-patrimonial/research");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "Credicorp Crecimiento",
    });
    expect(result.name).toBe("Credicorp VCS");
  });

  test("deleteFicha DELETEs the ficha by id", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(okJson({ ok: true }));
    await deleteFicha(9);
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/ficha-patrimonial/fichas/9");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  test("fichaToEnrichedRows maps lines to review rows (enrichment_failed from enriched)", () => {
    const ficha = {
      id: 1,
      user_id: null,
      client_name: "Ana",
      client_email: "a@x.com",
      client_phone: "",
      parse_failed: false,
      confirmed: false,
      created_at: null,
      status: "por_validar",
      lines: [
        {
          id: 10,
          excel_row: 8,
          raw_name: "Fondo A",
          raw_tipo_activo: "Fondos",
          raw_amount: 1000,
          raw_currency: "USD",
          raw_return_rate: "5%",
          raw_pertenencia: "Titular",
          mapped_asset_class: null,
          normalized_return_rate: "",
          enriched: { name: "Fondo A" },
          line_status: "approved",
        },
        {
          id: 11,
          excel_row: 9,
          raw_name: "Fondo B",
          raw_tipo_activo: "",
          raw_amount: 0,
          raw_currency: "",
          raw_return_rate: "",
          raw_pertenencia: "",
          mapped_asset_class: null,
          normalized_return_rate: "",
          enriched: null,
          line_status: "pending",
        },
      ],
    } as unknown as Ficha;

    const rows = fichaToEnrichedRows(ficha);
    expect(rows).toHaveLength(2);
    expect(rows[0].raw_name).toBe("Fondo A");
    expect(rows[0].enrichment_failed).toBe(false);
    expect(rows[0].line_id).toBe(10);
    expect(rows[1].enrichment_failed).toBe(true);
    expect(rows[1].line_id).toBe(11);
  });

  test("throws on a non-ok response", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "boom" }),
    } as Response);
    await expect(listFichas()).rejects.toThrow();
  });

  test("filenameFromDisposition prefers filename*, then filename, then fallback", () => {
    expect(
      filenameFromDisposition(
        "attachment; filename=\"ficha-5.xlsx\"; filename*=UTF-8''Javier%20Castro.xlsx",
        "f.xlsx",
      ),
    ).toBe("Javier Castro.xlsx");
    expect(filenameFromDisposition('attachment; filename="plain.xlsx"', "f.xlsx")).toBe(
      "plain.xlsx",
    );
    expect(filenameFromDisposition(null, "f.xlsx")).toBe("f.xlsx");
  });

  test("downloadFichaFile throws a friendly error on 404", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(downloadFichaFile(5)).rejects.toThrow(/no tiene un archivo guardado/i);
  });

  test("downloadFichaFile triggers a browser download on success", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["x"]),
      headers: { get: () => "attachment; filename*=UTF-8''mi.xlsx" },
    } as unknown as Response);

    const createObjectURL = vi.fn(() => "blob:url");
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const createEl = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor as unknown as HTMLAnchorElement);
    const append = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation((n) => n);

    try {
      await downloadFichaFile(5);

      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/admin/ficha-patrimonial/fichas/5/file",
      );
      expect(anchor.download).toBe("mi.xlsx");
      expect(anchor.click).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:url");
    } finally {
      createEl.mockRestore();
      append.mockRestore();
    }
  });
});
