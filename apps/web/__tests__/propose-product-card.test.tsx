import type { ComponentProps } from "react";
import { useContext, useEffect } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuiState, useThreadRuntime } from "@assistant-ui/react";
import {
  deriveResponseForProductFromThread,
  ProposalBatchContext,
  ProposalBatchProvider,
  ProposeProductCard,
  type ProposalEntry,
} from "@/components/assistant-ui/thread";

vi.mock("@assistant-ui/react", () => {
  const stub = () => new Proxy({}, { get: () => "div" });
  return {
    useAuiState: vi.fn((selector) => selector({ thread: { messages: [] }, message: { id: undefined } })),
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
  underlying?: { name: string; percentage: number }[];
  provider?: string;
};

let cardCounter = 0;

function cardProps(product: ProductInput, toolCallId = `tc_${++cardCounter}`) {
  return {
    result: { status: "proposed", product },
    toolCallId,
  } as unknown as ComponentProps<typeof ProposeProductCard>;
}

function errorCardProps() {
  return {
    result: { status: "error", message: "boom" },
    toolCallId: `tc_${++cardCounter}`,
  } as unknown as ComponentProps<typeof ProposeProductCard>;
}

/** Test-only consumer that reports every batch snapshot to the caller. */
function BatchSnapshot({
  onSnapshot,
}: {
  onSnapshot: (entries: Map<string, ProposalEntry> | undefined) => void;
}) {
  const batch = useContext(ProposalBatchContext);
  useEffect(() => {
    onSnapshot(batch?.entries);
  });
  return null;
}

function ConditionalCard({ show, product }: { show: boolean; product: ProductInput }) {
  return show ? <ProposeProductCard {...cardProps(product)} /> : null;
}

let appendMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  appendMock = vi.fn();
  vi.mocked(useAuiState).mockImplementation((selector) =>
    selector({ thread: { messages: [] }, message: { id: undefined } } as never),
  );
  vi.mocked(useThreadRuntime).mockReturnValue({ append: appendMock } as unknown as ReturnType<
    typeof useThreadRuntime
  >);
});

describe("ProposeProductCard rendering", () => {
  test("renders full product fields with no missing-fields warning", () => {
    render(
      <ProposeProductCard
        {...cardProps({
          name: "BlackRock Fund",
          amount: 1000,
          category: "mercados_publicos",
          underlying: [{ name: "Renta Fija US Treasuries", percentage: 100 }],
        })}
      />,
    );

    expect(screen.getByLabelText("Nombre")).toHaveValue("BlackRock Fund");
    expect(screen.getByLabelText("Monto (USD)")).toHaveValue(1000);
    expect(screen.getByLabelText("Categoría")).toHaveValue("mercados_publicos");
    expect(screen.getByText("Merc. públicos")).toBeInTheDocument();
    expect(screen.queryByText(/Completa:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).not.toBeDisabled();
  });

  test("shows a missing-fields warning and disables confirm when underlying is missing", () => {
    render(
      <ProposeProductCard
        {...cardProps({
          name: "Fondo X",
          amount: 500,
          category: "cash_y_equivalentes",
          underlying: undefined,
        })}
      />,
    );

    expect(screen.getByText(/composición/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).toBeDisabled();
  });

  test("renders nothing for a non-proposed tool result", () => {
    const { container } = render(<ProposeProductCard {...errorCardProps()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProposeProductCard field editing", () => {
  test("editing amount to a valid positive number clears the warning", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "Fondo X",
          amount: 0,
          category: "cash_y_equivalentes",
          underlying: [{ name: "Depósitos a plazo", percentage: 100 }],
        })}
      />,
    );

    expect(screen.getByText("Completa: monto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).toBeDisabled();

    const amountInput = screen.getByLabelText("Monto (USD)");
    await user.clear(amountInput);
    await user.type(amountInput, "500");

    expect(screen.queryByText(/Completa:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).not.toBeDisabled();
  });
});

describe("ProposeProductCard confirm and reject actions", () => {
  test("confirm sends the exact composed text and switches to confirmed", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "BlackRock Fund",
          amount: 1000,
          category: "mercados_publicos",
          underlying: [{ name: "Renta Fija", percentage: 100 }],
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sí, agregar" }));

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith({
      role: "user",
      content: [
        {
          type: "text",
          text: "Sí, agregar al portafolio con: nombre: BlackRock Fund, monto: 1000, categoría: Mercados públicos, underlying: [Renta Fija: 100%].",
        },
      ],
    });
    expect(screen.getByText("✓ Confirmado")).toBeInTheDocument();
  });

  test("confirm is a no-op when the card is invalid", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "",
          amount: 1000,
          category: "cash_y_equivalentes",
          underlying: [{ name: "Depósitos a plazo", percentage: 100 }],
        })}
      />,
    );

    const confirmButton = screen.getByRole("button", { name: "Sí, agregar" });
    expect(confirmButton).toBeDisabled();

    await user.click(confirmButton);

    expect(appendMock).not.toHaveBeenCalled();
    expect(screen.queryByText("✓ Confirmado")).not.toBeInTheDocument();
  });

  test("reject always sends the rejection text, even for an incomplete card", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "Fondo Y",
          amount: 500,
          category: "cash_y_equivalentes",
          underlying: undefined,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith({
      role: "user",
      content: [{ type: "text", text: 'No, no agregar "Fondo Y".' }],
    });
    expect(screen.getByText("✗ Descartado")).toBeInTheDocument();
  });
});

describe("ProposeProductCard registration in ProposalBatchProvider", () => {
  test("registers an entry on mount", async () => {
    let latest: Map<string, ProposalEntry> | undefined;

    render(
      <ProposalBatchProvider>
        <ProposeProductCard
          {...cardProps({
            name: "BlackRock Fund",
            amount: 1000,
            category: "mercados_publicos",
            underlying: [{ name: "Renta Fija", percentage: 100 }],
          })}
        />
        <BatchSnapshot onSnapshot={(entries) => (latest = entries)} />
      </ProposalBatchProvider>,
    );

    await waitFor(() => {
      expect(latest?.size).toBe(1);
      const [entry] = Array.from(latest!.values());
      expect(entry.isValid).toBe(true);
      expect(entry.responded).toBeNull();
    });
  });

  test("unregisters its entry on unmount", async () => {
    let latest: Map<string, ProposalEntry> | undefined;
    const product: ProductInput = {
      name: "BlackRock Fund",
      amount: 1000,
      category: "mercados_publicos",
      underlying: [{ name: "Renta Fija", percentage: 100 }],
    };

    const { rerender } = render(
      <ProposalBatchProvider>
        <ConditionalCard show product={product} />
        <BatchSnapshot onSnapshot={(entries) => (latest = entries)} />
      </ProposalBatchProvider>,
    );

    await waitFor(() => expect(latest?.size).toBe(1));

    rerender(
      <ProposalBatchProvider>
        <ConditionalCard show={false} product={product} />
        <BatchSnapshot onSnapshot={(entries) => (latest = entries)} />
      </ProposalBatchProvider>,
    );

    await waitFor(() => expect(latest?.size).toBe(0));
  });
});

describe("ProposeProductCard persisted response state", () => {
  test("derives confirmations from user messages anywhere in the thread", () => {
    const response = deriveResponseForProductFromThread(
      {
        name: "Fund B",
        amount: 800,
        category: "cash_y_equivalentes",
      },
      [
        {
          id: "user_1",
          role: "user",
          content: [
            {
              type: "text",
              text: "Sí, agregar todos al portafolio:\nnombre: Fund B, monto: 800, categoría: cash_y_equivalentes, underlying: [Fondos de Money Market: 100%]",
            },
          ],
        },
      ],
    );

    expect(response).toBe("yes");
  });

  test("derives confirmation from later successful add_product tool results", () => {
    const response = deriveResponseForProductFromThread(
      {
        name: "Fondo Visión Largo Plazo Global B",
        amount: 125000.4,
        category: "mercados_privados",
      },
      [
        {
          id: "user_1",
          role: "user",
          content: [{ type: "text", text: "Sí, agregalo." }],
        },
        {
          id: "assistant_2",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "add_product",
              toolCallId: "tc_add_product",
              result: {
                status: "added",
                product: {
                  name: "Fondo Vision Largo Plazo Global B",
                  amount: 125000,
                  category: "mercados_privados",
                },
              },
            },
          ],
        },
      ],
    );

    expect(response).toBe("yes");
  });

  test("derives a rejection from user messages anywhere in the thread", () => {
    const response = deriveResponseForProductFromThread(
      {
        name: "Fund C",
        amount: 900,
        category: "cash_y_equivalentes",
      },
      [
        {
          id: "user_1",
          role: "user",
          content: [
            {
              type: "text",
              text: 'No, no agregar "Fund C".',
            },
          ],
        },
      ],
    );

    expect(response).toBe("no");
  });

  test("blocks a remounted card when the same product was already added anywhere in the thread", () => {
    vi.mocked(useAuiState).mockImplementation((selector) =>
      selector({
        message: { id: "assistant_1" },
        thread: {
          messages: [
            {
              id: "assistant_2",
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolName: "add_product",
                  toolCallId: "tc_add_product",
                  result: {
                    status: "added",
                    product: {
                      name: "Fondo Edifica Core VI B",
                      amount: 55001.56,
                      category: "club_deals",
                    },
                  },
                },
              ],
            },
          ],
        },
      } as never),
    );

    render(
      <ProposeProductCard
        {...cardProps(
          {
            name: "Fondo Edífica Core VI B",
            amount: 55001.56,
            category: "club_deals",
          },
          "tc_existing",
        )}
      />,
    );

    expect(screen.getByText("✓ Confirmado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sí, agregar" })).not.toBeInTheDocument();
  });

  test("derives product response from an existing add_product result without message scoping", () => {
    const response = deriveResponseForProductFromThread(
      {
        name: "Fondo Edífica Core VI B",
        amount: 55001.56,
        category: "club_deals",
      },
      [
        {
          id: "assistant_2",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "add_product",
              toolCallId: "tc_add_product",
              result: {
                status: "added",
                product: {
                  name: "Fondo Edifica Core VI B",
                  amount: 55002,
                  category: "club_deals",
                },
              },
            },
          ],
        },
      ],
    );

    expect(response).toBe("yes");
  });
});
