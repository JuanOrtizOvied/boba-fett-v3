import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FichaPatrimonialPage from "@/app/admin/ficha-patrimonial/page";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  approveFichaLine,
  confirmFicha,
  deleteFicha,
  getFicha,
  listFichas,
  updateLineStatus,
} from "@/lib/fichaApi";
import type { Ficha, FichaParseResponse } from "@/lib/portfolio-types";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

// The page lives under <ToastProvider> in the app; the test renders it bare, so
// stub the toast hook with a spy we can assert approve feedback against.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

// Keep the pure helper real; stub the network calls so the mount list fetch
// (and ficha selection) don't go through `fetchWithAuth`.
vi.mock("@/lib/fichaApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fichaApi")>()),
  listFichas: vi.fn().mockResolvedValue([]),
  getFicha: vi.fn(),
  updateLineStatus: vi.fn().mockResolvedValue(undefined),
  confirmFicha: vi.fn().mockResolvedValue(undefined),
  deleteFicha: vi.fn().mockResolvedValue(undefined),
  approveFichaLine: vi
    .fn()
    .mockResolvedValue({ catalog_product_code: "BD-1", catalog_changes: {} }),
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
      mapped_asset_class: "Mercados Publicos - Fijo",
      normalized_return_rate: "5.0",
      enriched: null,
      enrichment_failed: false,
    },
  ],
  ficha_id: 7,
};

async function selectFile(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const user = userEvent.setup();
  await user.upload(input, file);
}

describe("FichaPatrimonialPage idle state", () => {
  test("renders the sidebar and the upload zone", () => {
    render(<FichaPatrimonialPage />);
    expect(screen.getByText("Fichas patrimoniales")).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
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
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  test("on a network exception shows a generic error and returns to the upload zone", async () => {
    vi.mocked(fetchWithAuth).mockRejectedValue(new Error("Failed to fetch"));

    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));

    expect(await screen.findByText("Failed to fetch")).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
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

    await user.click(
      screen.getByRole("button", { name: "Aprobar y crear producto" }),
    );
    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    expect(
      await screen.findByText(/se import(ó|aron) 1 producto/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cargar otra ficha/i }),
    ).toBeInTheDocument();
    // The ficha is also marked confirmed (→ validada) via the persistence API.
    expect(confirmFicha).toHaveBeenCalledWith(7);
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
    await user.click(
      screen.getByRole("button", { name: "Aprobar y crear producto" }),
    );
    await user.click(screen.getByRole("button", { name: /confirmar/i }));
    await screen.findByText(/se import(ó|aron) 1 producto/i);

    await user.click(screen.getByRole("button", { name: /cargar otra ficha/i }));

    expect(screen.queryByText(/cliente@sabbi\.com/)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });
});

describe("FichaPatrimonialPage approve feedback", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset();
    toastSpy.mockClear();
    vi.mocked(approveFichaLine).mockResolvedValue({
      catalog_product_code: "BD-1",
      catalog_changes: {},
    });
  });

  async function enterReviewAndApprove() {
    vi.mocked(fetchWithAuth).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => PARSE_RESPONSE,
    } as Response);
    const user = userEvent.setup();
    render(<FichaPatrimonialPage />);
    await selectFile(makeFile("ficha.xlsx", 1024));
    await screen.findByText(/cliente@sabbi\.com/);
    await user.click(
      screen.getByRole("button", { name: "Aprobar y crear producto" }),
    );
  }

  test("shows a success toast after a product is updated", async () => {
    await enterReviewAndApprove();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringMatching(/producto/i),
      "success",
    );
  });

  test("shows an error toast when the approve request fails", async () => {
    vi.mocked(approveFichaLine).mockRejectedValueOnce(new Error("500"));
    await enterReviewAndApprove();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.stringMatching(/no se pudo/i),
      "error",
    );
  });
});

describe("FichaPatrimonialPage sidebar", () => {
  test("selecting a saved ficha loads it into the review pane", async () => {
    vi.mocked(listFichas).mockResolvedValue([
      {
        id: 42,
        client_name: "Saved Client",
        client_email: "saved@x.com",
        created_at: null,
        line_count: 1,
        status: "en_proceso",
      },
    ]);
    vi.mocked(getFicha).mockResolvedValue({
      id: 42,
      user_id: null,
      client_name: "Saved Client",
      client_email: "saved@x.com",
      client_phone: "",
      parse_failed: false,
      confirmed: false,
      created_at: null,
      status: "en_proceso",
      lines: [
        {
          id: 1,
          excel_row: 8,
          raw_name: "Loaded Fund",
          raw_tipo_activo: "",
          raw_amount: 100,
          raw_currency: "USD",
          raw_return_rate: "",
          raw_pertenencia: "",
          mapped_asset_class: "Mercados Publicos - Fijo",
          normalized_return_rate: "",
          enriched: null,
          line_status: "pending",
        },
      ],
    } as Ficha);

    const user = userEvent.setup();
    render(<FichaPatrimonialPage />);

    await user.click(await screen.findByTestId("ficha-row-42"));

    expect(await screen.findByText(/saved@x\.com/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Loaded Fund")).toBeInTheDocument();

    // Approving a loaded (persisted) line writes it back via the API.
    await user.click(
      screen.getByRole("button", { name: "Aprobar y crear producto" }),
    );
    expect(updateLineStatus).toHaveBeenCalledWith(1, "approved");
  });

  test("deleting a ficha from the sidebar calls the delete API", async () => {
    vi.mocked(listFichas).mockResolvedValue([
      {
        id: 42,
        client_name: "Saved Client",
        client_email: "saved@x.com",
        created_at: null,
        line_count: 1,
        status: "en_proceso",
      },
    ]);

    const user = userEvent.setup();
    render(<FichaPatrimonialPage />);

    await user.click(
      await screen.findByRole("button", { name: "Eliminar Saved Client" }),
    );

    expect(deleteFicha).toHaveBeenCalledWith(42);
  });
});
