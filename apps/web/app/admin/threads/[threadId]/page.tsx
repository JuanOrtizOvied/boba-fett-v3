"use client";

import { useEffect, useState, type FC } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  CATEGORY_META,
  resolveCategoryKey,
  categoryBgVar,
  categoryTextVar,
} from "@/lib/categories";
import { formatUsd } from "@/lib/format";
import type { Category, FieldSource } from "@/lib/portfolio-types";

// -- Types ----------------------------------------------------------------

type ContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  source?: { media_type?: string; data?: string };
  title?: string;
};

type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type AdminThreadMessage = {
  id?: string;
  type: string;
  content: string | ContentBlock[] | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

// -- Content extraction ---------------------------------------------------

function extractTextBlocks(content: AdminThreadMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b) =>
        b.type === "text" &&
        b.text &&
        !b.text.startsWith("[Archivo adjunto"),
    )
    .map((b) => b.text!)
    .join("\n");
}

function extractThinking(content: AdminThreadMessage["content"]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "thinking" && b.thinking)
    .map((b) => b.thinking!)
    .join("\n");
}

function getAttachmentLabels(content: AdminThreadMessage["content"]): string[] {
  if (!Array.isArray(content)) return [];
  const labels: string[] = [];
  for (const b of content) {
    if (b.type === "image") labels.push(b.title ?? "Imagen");
    else if (b.type === "document")
      labels.push(b.title ?? b.source?.media_type ?? "Documento");
    else if (b.type === "file") labels.push(b.title ?? "Archivo");
    else if (b.type === "text" && b.text?.startsWith("[Archivo adjunto")) {
      const match = b.text.match(/\[Archivo adjunto: (.+)\]/);
      labels.push(match?.[1] ?? "Archivo");
    }
  }
  return labels;
}

function parseJson<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw as T;
}

// -- Reliability badge (same as user chat) --------------------------------

const RELIABILITY_BADGE: Record<string, { label: string; className: string }> = {
  verified: {
    label: "Catálogo SABBI ✓",
    className: "border-green-200 bg-green-50 text-green-700",
  },
  web: {
    label: "Búsqueda web ⚠",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  unverified: {
    label: "No verificado",
    className:
      "border-sabbi-neutral-200 bg-sabbi-neutral-100 text-sabbi-neutral-600",
  },
};

function ReliabilityBadge({ tag }: { tag?: string }) {
  const badge = RELIABILITY_BADGE[tag ?? ""] ?? RELIABILITY_BADGE.unverified;
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

function FieldSourceMarker({ source }: { source?: FieldSource }) {
  if (!source || source === "catalog") return null;
  const icon = source === "web_search" ? "🌐" : "🤖";
  const label =
    source === "web_search"
      ? "Fuente: búsqueda web"
      : "Fuente: conocimiento de Claude";
  return (
    <span title={label} className="ml-1 text-[10px]">
      {icon}
    </span>
  );
}

// -- Enriched field display -----------------------------------------------

type EnrichedFieldKey =
  | "commission"
  | "currency"
  | "administrator"
  | "manager"
  | "liquidity"
  | "return_rate";

const ENRICHED_FIELDS: { key: EnrichedFieldKey; label: string }[] = [
  { key: "commission", label: "Comisión" },
  { key: "currency", label: "Moneda" },
  { key: "administrator", label: "Administradora" },
  { key: "manager", label: "Gestor" },
  { key: "liquidity", label: "Liquidez" },
  { key: "return_rate", label: "Rentabilidad histórica" },
];

// -- Tool result types ----------------------------------------------------

interface ToolResultProduct {
  name: string;
  amount: number;
  category: Category;
}

type PortfolioToolResult =
  | { status: "added" | "updated"; product: ToolResultProduct }
  | { status: "deleted"; product_id: string }
  | { status: "error"; message: string };

interface ProposedProduct {
  name: string;
  amount: number;
  category: string;
  provider?: string;
  commission?: string;
  currency?: string;
  administrator?: string;
  manager?: string;
  liquidity?: string;
  return_rate?: string;
  reliability_tag?: string;
  provenance?: Record<string, FieldSource>;
  [key: string]: unknown;
}

type ProposeToolResult =
  | { status: "proposed"; product: ProposedProduct }
  | { status: "error"; message: string };

// -- Sub-components -------------------------------------------------------

const UserMessageBubble: FC<{ message: AdminThreadMessage }> = ({
  message,
}) => {
  const text = extractTextBlocks(message.content);
  const attachments = getAttachmentLabels(message.content);

  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
      <div className="flex flex-col gap-2 rounded-[18px_18px_4px_18px] bg-sabbi-primary px-4 py-2.5 text-white">
        {text && <p className="whitespace-pre-wrap text-sm">{text}</p>}
        {attachments.map((label, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/[.12] px-2.5 py-1.5 text-xs"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="truncate">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReadOnlyProposalCard: FC<{
  product: ProposedProduct;
  confirmed: boolean;
}> = ({ product, confirmed }) => {
  const catKey = resolveCategoryKey(product.category);
  const meta = CATEGORY_META[catKey];
  if (!meta) return null;

  const provenance = product.provenance;
  const enrichedFields = ENRICHED_FIELDS.filter(
    ({ key }) => product[key],
  );

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-sabbi-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-sabbi-neutral-200 bg-[var(--bg-panel)] px-4 py-2.5 text-xs font-semibold text-sabbi-neutral-700">
        <div className="flex items-center gap-2">
          <span
            className="tool-badge"
            style={{
              background: categoryBgVar(catKey),
              color: categoryTextVar(catKey),
            }}
          >
            {meta.shortLabel}
          </span>
          Producto encontrado
        </div>
        <ReliabilityBadge tag={product.reliability_tag} />
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-sabbi-neutral-500">
            Nombre
          </span>
          <span className="text-sm font-semibold text-sabbi-neutral-900">
            {product.name}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-sabbi-neutral-500">
            Proveedor
          </span>
          <span className="text-sm text-sabbi-neutral-700">
            {product.provider || "—"}
          </span>
        </div>

        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-medium text-sabbi-neutral-500">
              Monto (USD)
            </span>
            <span className="font-display text-lg font-semibold text-[var(--accent-text)]">
              {formatUsd(product.amount || 0)}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-medium text-sabbi-neutral-500">
              Categoría
            </span>
            <span className="text-sm text-sabbi-neutral-700">
              {meta.label}
            </span>
          </div>
        </div>

        {enrichedFields.length > 0 && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-sabbi-neutral-100 pt-2.5">
            {enrichedFields.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-sabbi-neutral-500">
                  {label}
                </span>
                <span className="text-sm text-sabbi-neutral-700">
                  {product[key] as string}
                  <FieldSourceMarker source={provenance?.[key]} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-sabbi-neutral-200 px-4 py-2 text-xs text-sabbi-neutral-500">
        {confirmed ? "✓ Confirmado" : "— Propuesto"}
      </div>
    </div>
  );
};

const ToolResultRow: FC<{ result: PortfolioToolResult; args?: Record<string, unknown> }> = ({
  result,
  args,
}) => {
  if (result.status === "error") return null;

  if (result.status === "deleted") {
    const productId =
      result.product_id ?? (args?.["product_id"] as string | undefined);
    return (
      <div className="tool-result-item">
        <span
          className="tool-badge"
          style={{
            background: "var(--danger-light)",
            color: "var(--danger-text)",
          }}
        >
          Eliminado
        </span>
        <span className="tool-item-name truncate">
          {productId ?? "Producto"}
        </span>
      </div>
    );
  }

  const { product } = result;
  const catKey = resolveCategoryKey(product.category);
  const meta = CATEGORY_META[catKey];
  if (!meta) return null;

  return (
    <div className="tool-result-item">
      <span
        className="tool-badge"
        style={{
          background: categoryBgVar(catKey),
          color: categoryTextVar(catKey),
        }}
      >
        {meta.shortLabel}
      </span>
      <span className="tool-item-name truncate">{product.name}</span>
      <span className="tool-item-amount">{formatUsd(product.amount)}</span>
    </div>
  );
};

const ThinkingSection: FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-sabbi-neutral-600 hover:text-sabbi-neutral-900"
      >
        <span
          className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        Ver razonamiento
      </button>
      {open && (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-sabbi-neutral-200 bg-[var(--bg-panel)] px-3 py-2 text-xs leading-relaxed text-sabbi-neutral-600">
          {text}
        </div>
      )}
    </div>
  );
};

const CollapsibleRaw: FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-sabbi-neutral-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-sabbi-neutral-50 px-3 py-1.5 text-xs font-medium text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
      >
        <span
          className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        {title}
      </button>
      {open && (
        <div className="max-h-60 overflow-y-auto bg-white px-3 py-2 text-xs text-sabbi-neutral-700">
          {children}
        </div>
      )}
    </div>
  );
};

const AssistantMessageBubble: FC<{
  message: AdminThreadMessage;
  toolMessages: Map<string, AdminThreadMessage>;
  allMessages: AdminThreadMessage[];
}> = ({ message, toolMessages, allMessages }) => {
  const text = extractTextBlocks(message.content);
  const thinking = extractThinking(message.content);
  const toolCalls = message.tool_calls ?? [];

  const proposeCalls: { tc: ToolCall; product: ProposedProduct }[] = [];
  const portfolioCalls: { tc: ToolCall; result: PortfolioToolResult }[] = [];
  const otherCalls: { tc: ToolCall; resultContent: unknown }[] = [];

  for (const tc of toolCalls) {
    const toolMsg = toolMessages.get(tc.id);
    const raw = toolMsg ? parseJson(toolMsg.content) : null;

    if (tc.name === "propose_product") {
      const parsed = raw as ProposeToolResult | null;
      if (parsed?.status === "proposed") {
        proposeCalls.push({ tc, product: parsed.product });
      }
    } else if (
      tc.name === "add_product" ||
      tc.name === "update_product" ||
      tc.name === "delete_product"
    ) {
      const parsed = raw as PortfolioToolResult | null;
      if (parsed) {
        portfolioCalls.push({ tc, result: parsed });
      }
    } else {
      otherCalls.push({ tc, resultContent: raw });
    }
  }

  const addedNames = new Set<string>();
  for (const msg of allMessages) {
    if (msg.type !== "tool") continue;
    const parsed = parseJson<PortfolioToolResult>(msg.content);
    if (parsed && "product" in parsed && parsed.status === "added") {
      addedNames.add(parsed.product.name.toLowerCase());
    }
  }

  return (
    <div className="mr-auto flex w-full min-w-0 flex-col items-start gap-1">
      <div className="min-w-0 max-w-full px-0 py-2 text-sabbi-neutral-900">
        {thinking && <ThinkingSection text={thinking} />}

        {proposeCalls.map(({ tc, product }) => {
          const confirmed = addedNames.has(product.name.toLowerCase());
          return (
            <ReadOnlyProposalCard
              key={tc.id}
              product={product}
              confirmed={confirmed}
            />
          );
        })}

        {text && (
          <div className="assistant-markdown prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        )}

        {portfolioCalls.map(({ tc, result }) => (
          <ToolResultRow key={tc.id} result={result} args={tc.args} />
        ))}

        {!text &&
          proposeCalls.length === 0 &&
          portfolioCalls.length === 0 &&
          otherCalls.length === 0 && (
            <p className="text-sm italic text-sabbi-neutral-500">
              (mensaje sin texto)
            </p>
          )}

        {(otherCalls.length > 0 ||
          toolCalls.length > 0) && (
          <CollapsibleRaw
            title={`Asistente & Herramientas (${toolCalls.length})`}
          >
            <div className="flex flex-col gap-2">
              {toolCalls.map((tc) => {
                const toolMsg = toolMessages.get(tc.id);
                return (
                  <div
                    key={tc.id}
                    className="rounded-md border border-sabbi-neutral-100 bg-sabbi-neutral-50 p-2"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded bg-sabbi-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-sabbi-primary">
                        {tc.name}
                      </span>
                    </div>
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-sabbi-neutral-500 hover:text-sabbi-neutral-700">
                        Argumentos
                      </summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-sabbi-neutral-600">
                        {JSON.stringify(tc.args, null, 2)}
                      </pre>
                    </details>
                    {toolMsg && (
                      <details className="mt-1 text-[11px]">
                        <summary className="cursor-pointer text-sabbi-neutral-500 hover:text-sabbi-neutral-700">
                          Resultado
                        </summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-sabbi-neutral-600">
                          {typeof toolMsg.content === "string"
                            ? toolMsg.content
                            : JSON.stringify(toolMsg.content, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </CollapsibleRaw>
        )}
      </div>
    </div>
  );
};

const SystemMessageBubble: FC<{ message: AdminThreadMessage }> = ({
  message,
}) => {
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .map((b) => b.text ?? "")
            .join("\n")
        : "";

  return (
    <div className="mx-auto max-w-[90%]">
      <CollapsibleRaw title="Mensaje del sistema">
        <p className="whitespace-pre-wrap text-xs text-sabbi-neutral-600">
          {text || "(vacío)"}
        </p>
      </CollapsibleRaw>
    </div>
  );
};

// -- Page -----------------------------------------------------------------

export default function AdminThreadViewPage() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;
  const [messages, setMessages] = useState<AdminThreadMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/threads/${threadId}`);
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar la conversación (status ${res.status})`,
          );
        }
        const data: { messages: AdminThreadMessage[] } = await res.json();
        setMessages(data.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, [threadId]);

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">
          Conversación
        </h1>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (messages === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">
          Conversación
        </h1>
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">
          Conversación
        </h1>
        <p className="text-sm text-sabbi-neutral-600">
          Esta conversación todavía no tiene mensajes.
        </p>
      </div>
    );
  }

  const toolMessageMap = new Map<string, AdminThreadMessage>();
  for (const msg of messages) {
    if (msg.type === "tool" && msg.tool_call_id) {
      toolMessageMap.set(msg.tool_call_id, msg);
    }
  }

  const visibleMessages = messages.filter(
    (m) => m.type !== "tool",
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">
        Conversación
      </h1>

      <div className="flex flex-col gap-4 overflow-y-auto px-4 py-6">
        {visibleMessages.map((message, index) => (
          <div key={message.id ?? index}>
            {message.type === "human" && (
              <UserMessageBubble message={message} />
            )}
            {message.type === "ai" && (
              <AssistantMessageBubble
                message={message}
                toolMessages={toolMessageMap}
                allMessages={messages}
              />
            )}
            {message.type === "system" && (
              <SystemMessageBubble message={message} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
