import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  confirmFicha,
  getFicha,
  listFichas,
  updateLineStatus,
} from "@/lib/fichaApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

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

  test("throws on a non-ok response", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: "boom" }),
    } as Response);
    await expect(listFichas()).rejects.toThrow();
  });
});
