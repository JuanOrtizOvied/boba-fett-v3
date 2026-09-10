import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FichaPatrimonialPage from "@/app/admin/ficha-patrimonial/page";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { FichaParseResponse } from "@/lib/portfolio-types";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

function makeFile(name: string, sizeBytes: number): File {
  const file = new File([new Uint8Array(Math.max(sizeBytes, 0))], name);
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

const PARSE_RESPONSE: FichaParseResponse = {
  client: {
    email: "cliente@sabbi.com",
    name: "Cliente Uno",
    phone: "",
    user_id: "user-1",
  },
  rows: [
    {
      excel_row: 8,
      raw_name: "Fondo X",
      raw_tipo_activo: "Fondos mutuos",
      raw_amount: 1000,
      raw_currency: "USD",
      raw_return_rate: "5%",
      raw_pertenencia: "Titular",
      mapped_asset_class: "mercados_publicos",
      normalized_return_rate: "5.0",
      enriched: null,
      enrichment_failed: false,
    },
  ],
};

async function selectFile(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const user = userEvent.setup();
  await user.upload(input, file);
}

describe("FichaPatrimonialPage idle state", () => {
  test("renders the upload zone with .xlsx instructions", () => {
    render(<FichaPatrimonialPage />);
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByText(/\.xlsx/)).toBeInTheDocument();
  });
});

describe("FichaPatrimonialPage upload flow", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset();
  });

  test("selecting a file shows a loading state and posts base64 payload to the parse endpoint", async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetchWithAuth).mockReturnValue(pending);

    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));

    expect(
      await screen.findByText(/analizando|procesando/i),
    ).toBeInTheDocument();

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/ficha-patrimonial/parse");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.file_name).toBe("ficha.xlsx");
    expect(typeof body.file_data).toBe("string");
    expect(body.file_data.length).toBeGreaterThan(0);
    expect(body.file_data).not.toMatch(/^data:/);

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => PARSE_RESPONSE,
    } as Response);
  });

  test("on success transitions to the review state with client info and row count", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => PARSE_RESPONSE,
    } as Response);

    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));

    expect(
      await screen.findByText(/cliente@sabbi\.com/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 fila/i)).toBeInTheDocument();
  });

  test("on parse failure shows the server error and returns to the upload zone", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "No se encontró la hoja 'Sabbi'" }),
    } as Response);

    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));

    expect(
      await screen.findByText("No se encontró la hoja 'Sabbi'"),
    ).toBeInTheDocument();
    // The upload zone is usable again — no stuck loading/partial table.
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  test("on a network exception shows a generic error and returns to the upload zone", async () => {
    vi.mocked(fetchWithAuth).mockRejectedValue(new Error("Failed to fetch"));

    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));

    expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});

describe("FichaPatrimonialPage confirm wiring", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset();
  });

  test("confirming the review table's ReviewTable shows a success summary with the imported count", async () => {
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => PARSE_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ created_count: 1, product_ids: ["p1"] }),
      } as Response);

    const user = userEvent.setup();
    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));
    await screen.findByText(/cliente@sabbi\.com/);

    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    expect(
      await screen.findByText(/se import(ó|aron) 1 producto/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cargar otra ficha/i }),
    ).toBeInTheDocument();
  });

  test("returning to the upload zone from the success state clears the previous parse result", async () => {
    vi.mocked(fetchWithAuth)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => PARSE_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ created_count: 1, product_ids: ["p1"] }),
      } as Response);

    const user = userEvent.setup();
    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));
    await screen.findByText(/cliente@sabbi\.com/);
    await user.click(screen.getByRole("button", { name: /confirmar/i }));
    await screen.findByText(/se import(ó|aron) 1 producto/i);

    await user.click(screen.getByRole("button", { name: /cargar otra ficha/i }));

    expect(screen.queryByText(/cliente@sabbi\.com/)).not.toBeInTheDocument();
    expect(screen.getByText(/\.xlsx/)).toBeInTheDocument();
  });
});
