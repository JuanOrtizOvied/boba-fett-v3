import type { ComponentProps } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useThreadRuntime } from "@assistant-ui/react";
import {
  BulkAcceptBar,
  ProposalBatchProvider,
  ProposeProductCard,
} from "@/components/assistant-ui/thread";

vi.mock("@assistant-ui/react", () => {
  const stub = () => new Proxy({}, { get: () => "div" });
  return {
    useThreadRuntime: vi.fn(() => ({ append: vi.fn() })),
    MessagePrimitive: stub(),
    ActionBarPrimitive: stub(),
    AttachmentPrimitive: stub(),
    ComposerPrimitive: stub(),
    ErrorPrimitive: stub(),
    ThreadPrimitive: stub(),
  };
});

type ProductInput = {
  name?: string;
  amount?: number;
  category?: string;
  subcategory?: string;
  provider?: string;
};

let cardCounter = 0;

function cardProps(product: ProductInput) {
  return {
    result: { status: "proposed", product },
    toolCallId: `tc_${++cardCounter}`,
  } as unknown as ComponentProps<typeof ProposeProductCard>;
}

const FUND_A: ProductInput = {
  name: "Fund A",
  amount: 500,
  category: "cash_y_equivalentes",
  subcategory: "Depósitos a plazo",
};

const FUND_B_VALID: ProductInput = {
  name: "Fund B",
  amount: 800,
  category: "cash_y_equivalentes",
  subcategory: "Fondos de Money Market",
};

const FUND_B_INCOMPLETE: ProductInput = {
  name: "Fund B",
  amount: 800,
  category: "cash_y_equivalentes",
  subcategory: undefined,
};

let appendMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  appendMock = vi.fn();
  vi.mocked(useThreadRuntime).mockReturnValue({ append: appendMock } as unknown as ReturnType<
    typeof useThreadRuntime
  >);
});

describe("BulkAcceptBar visibility gating", () => {
  test("renders nothing with a single pending entry", async () => {
    render(
      <ProposalBatchProvider>
        <ProposeProductCard {...cardProps(FUND_A)} />
        <BulkAcceptBar />
      </ProposalBatchProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByText(/productos listos/)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Agregar todos" })).not.toBeInTheDocument();
  });

  test("shows count and disables bulk button when 2+ pending entries include an invalid one", async () => {
    render(
      <ProposalBatchProvider>
        <ProposeProductCard {...cardProps(FUND_A)} />
        <ProposeProductCard {...cardProps(FUND_B_INCOMPLETE)} />
        <BulkAcceptBar />
      </ProposalBatchProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("1 de 2 productos listos")).toBeInTheDocument();
    });
    expect(screen.getByText(/Fund B/)).toBeInTheDocument();
    expect(screen.getByText(/completa: subcategoría/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar todos" })).toBeDisabled();
  });

  test("hides once all entries have been responded to individually", async () => {
    const user = userEvent.setup();
    render(
      <ProposalBatchProvider>
        <ProposeProductCard {...cardProps(FUND_A)} />
        <ProposeProductCard {...cardProps(FUND_B_VALID)} />
        <BulkAcceptBar />
      </ProposalBatchProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("2 de 2 productos listos")).toBeInTheDocument();
    });

    const confirmButtons = screen.getAllByRole("button", { name: "Sí, agregar" });
    await user.click(confirmButtons[0]);
    await user.click(confirmButtons[1]);

    await waitFor(() => {
      expect(screen.queryByText(/productos listos/)).not.toBeInTheDocument();
    });
  });
});

describe("BulkAcceptBar combined confirmation", () => {
  test("Agregar todos sends one combined message and marks all entries responded", async () => {
    const user = userEvent.setup();
    render(
      <ProposalBatchProvider>
        <ProposeProductCard {...cardProps(FUND_A)} />
        <ProposeProductCard {...cardProps(FUND_B_VALID)} />
        <BulkAcceptBar />
      </ProposalBatchProvider>,
    );

    const bulkButton = await screen.findByRole("button", { name: "Agregar todos" });
    expect(bulkButton).not.toBeDisabled();

    await user.click(bulkButton);

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith({
      role: "user",
      content: [
        {
          type: "text",
          text:
            "Sí, agregar todos al portafolio:\n" +
            "nombre: Fund A, monto: 500, categoría: cash_y_equivalentes, subcategory: Depósitos a plazo\n" +
            "nombre: Fund B, monto: 800, categoría: cash_y_equivalentes, subcategory: Fondos de Money Market",
        },
      ],
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Agregar todos" })).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("✓ Confirmado")).toHaveLength(2);
  });
});
