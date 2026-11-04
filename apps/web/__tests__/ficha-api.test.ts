import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  approveFichaLine,
  confirmFicha,
  deleteFicha,
  fichaToEnrichedRows,
  getFicha,
  listFichas,
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

  test("approveFichaLine POSTs the approve payload", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue(
      okJson({ product_id: "p1", catalog_changes: {} }),
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
});
