"use client";

import { useMemo, useState, type FC } from "react";
import { ThinkingPanel } from "@/components/chat/ThinkingPanel";
import type {
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
  ToolCallMessagePartProps,
  EmptyMessagePartProps,
  ReasoningMessagePartProps,
} from "@assistant-ui/react";
import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useThreadRuntime,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import {
  CameraIcon,
  ClipIcon,
  FileIcon,
  LinkIcon,
  PdfIcon,
  RobotIcon,
  SendIcon,
} from "@/components/icons/Icons";
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  CATEGORY_SUBCATEGORIES,
  categoryBgVar,
  categoryTextVar,
} from "@/lib/categories";
import { formatUsd } from "@/lib/format";
import type { Category, EnrichedProposedProduct, FieldSource } from "@/lib/portfolio-types";

/**
 * Converts a `File` to a base64 data URL, matching the pattern used by
 * `SimpleImageAttachmentAdapter` in `@assistant-ui/core`.
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Attachment adapter for PDFs and other binary documents (statements,
 * factsheets). Converts the file to a base64 `file` content part so it
 * reaches the LangGraph agent the same way `getMessageContent` expects
 * (`{ type: "file", data, mime_type, metadata: { filename } }`).
 */
class Base64DocumentAttachmentAdapter implements AttachmentAdapter {
  public accept = "*";

  async add(state: { file: File }): Promise<PendingAttachment> {
    return {
      id: `${state.file.name}-${state.file.size}-${Date.now()}`,
      type: "document",
      name: state.file.name,
      contentType: state.file.type || "application/octet-stream",
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const dataUrl = await readFileAsDataUrl(attachment.file);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          data: base64,
          mimeType: attachment.contentType ?? "application/octet-stream",
        },
      ],
    };
  }

  async remove() {
    // No remote resource to clean up — the file only ever lives client-side
    // until it is inlined as base64 in the outgoing message.
  }
}

/**
 * Shared attachment adapter — images go through the base64 `SimpleImage`
 * adapter, PDFs/documents through `Base64DocumentAttachmentAdapter`. Exported
 * so `assistant.tsx` can wire it into `useLangGraphRuntime`'s `adapters`.
 */
export const attachmentAdapter = new Base64DocumentAttachmentAdapter();

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentIcon({ attachment, size = 16 }: { attachment: Attachment; size?: number }) {
  if (attachment.type === "image") return <CameraIcon size={size} />;
  if (attachment.contentType === "application/pdf") return <PdfIcon size={size} />;
  return <FileIcon size={size} />;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "FILE";
}

/**
 * Chat thread UI wired to the LangGraph runtime, styled for SABBI:
 * - User messages: indigo accent background, file attachments as chips
 *   inside the same bubble (never separate messages).
 * - Assistant messages: neutral background, recoverable error UI.
 * - Welcome message listing supported input types when the thread is empty.
 * - Pinned composer with drag-and-drop / click-to-upload and quick-action
 *   shortcuts (Captura, PDF, Link, Factsheet).
 */
export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-background">
      <ComposerPrimitive.AttachmentDropzone className="group/drop relative flex min-h-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center rounded-xl border-2 border-dashed border-sabbi-primary bg-sabbi-primary-soft/40 backdrop-blur-[2px] group-data-[dragging=true]/drop:flex">
          <div className="flex flex-col items-center gap-2 text-sabbi-primary">
            <ClipIcon size={32} />
            <span className="text-sm font-medium">Soltar archivo aquí</span>
          </div>
        </div>

        <ThreadPrimitive.Viewport autoScroll className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden px-4 py-6">
          <ThreadPrimitive.If empty>
            <WelcomeMessage />
          </ThreadPrimitive.If>

          <ThreadPrimitive.Messages>
            {({ message }) => {
              if (message.role === "user") return <UserMessage />;
              if (message.role === "assistant") return <AssistantMessage />;
              return null;
            }}
          </ThreadPrimitive.Messages>

          <ThinkingPanel />
        </ThreadPrimitive.Viewport>

        <div className="shrink-0 border-t border-sabbi-neutral-200 px-4 py-4">
          <Composer />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ThreadPrimitive.Root>
  );
};

const SUPPORTED_INPUTS = [
  { icon: CameraIcon, label: "Capturas de pantalla" },
  { icon: PdfIcon, label: "PDFs de estados de cuenta" },
  { icon: FileIcon, label: "Factsheets de fondos" },
  { icon: LinkIcon, label: "Links de productos" },
] as const;

const WelcomeMessage: FC = () => {
  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-sabbi-primary-soft text-sabbi-primary">
        <RobotIcon size={24} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-sabbi-neutral-900">
          ¡Hola! Soy el asistente de SABBI
        </p>
        <p className="text-sm text-sabbi-neutral-600">
          Contame sobre tus inversiones y arme tu portafolio. Podés
          compartirme:
        </p>
      </div>
      <ul className="flex w-full flex-col gap-2">
        {SUPPORTED_INPUTS.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-2 rounded-lg bg-sabbi-neutral-50 px-3 py-2 text-left text-sm text-sabbi-neutral-700"
          >
            <Icon size={18} className="shrink-0 text-sabbi-primary" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
};

import type { FileMessagePartProps, ImageMessagePartProps } from "@assistant-ui/react";

const UserImagePart: FC<ImageMessagePartProps> = ({ image }) => (
  <img src={image} alt="" className="max-h-48 max-w-full rounded-lg" />
);

function fileTypeLabel(mimeType: string | undefined): string {
  if (!mimeType) return "FILE";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "XLSX";
  if (mimeType.includes("word") || mimeType.includes("document")) return "DOC";
  if (mimeType.startsWith("image/")) return mimeType.split("/")[1]?.toUpperCase() ?? "IMG";
  return "FILE";
}

function FileTypeIcon({ mimeType }: { mimeType?: string }) {
  if (mimeType === "application/pdf") return <PdfIcon size={20} />;
  if (mimeType?.startsWith("image/")) return <CameraIcon size={20} />;
  return <FileIcon size={20} />;
}

function base64ToBlobUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: match[1] });
  return URL.createObjectURL(blob);
}

const UserFileChip: FC<FileMessagePartProps> = ({ filename, mimeType, data }) => {
  const label = filename ?? "Archivo";
  const badge = fileTypeLabel(mimeType);
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType?.startsWith("image/");

  const blobUrl = useMemo(() => (data ? base64ToBlobUrl(data) : null), [data]);

  const handleDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = label;
    a.click();
  };

  if (isPdf && blobUrl) {
    return (
      <div className="w-full max-w-xs overflow-hidden rounded-lg border border-white/20">
        <iframe
          src={blobUrl}
          title={label}
          className="pointer-events-none h-44 w-full bg-white"
        />
        <div className="flex items-center justify-between bg-white/[.12] px-3 py-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <PdfIcon size={14} />
            <span className="truncate text-xs font-medium">{label}</span>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="text-[10px] font-medium hover:underline"
            >
              Descargar
            </button>
            <button
              type="button"
              onClick={() => window.open(blobUrl, "_blank")}
              className="text-[10px] font-medium hover:underline"
            >
              Abrir ↗
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isImage && data) {
    return (
      <div className="w-full max-w-xs overflow-hidden rounded-lg border border-white/20">
        <img src={data} alt={label} className="max-h-48 w-full object-contain" />
        <div className="flex items-center justify-between bg-white/[.12] px-3 py-1.5">
          <span className="truncate text-xs font-medium">{label}</span>
          <button
            type="button"
            onClick={() => blobUrl && window.open(blobUrl, "_blank")}
            className="shrink-0 text-[10px] font-medium hover:underline"
          >
            Abrir ↗
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={blobUrl ? () => window.open(blobUrl, "_blank") : undefined}
      className={`flex items-center gap-2.5 rounded-lg border border-white/20 bg-white/[.12] px-3 py-2 text-left text-xs transition-colors ${blobUrl ? "cursor-pointer hover:bg-white/[.2]" : "cursor-default"}`}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[.15]">
        <FileTypeIcon mimeType={mimeType} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="max-w-[180px] truncate font-medium">{label}</span>
        <span className="text-[10px] text-white/60">
          {badge}
          {blobUrl ? " · Click para abrir" : ""}
        </span>
      </div>
    </button>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
      <div className="flex flex-col gap-2 rounded-[18px_18px_4px_18px] bg-sabbi-primary px-4 py-2.5 text-white">
        <MessagePrimitive.Content
          components={{
            Image: UserImagePart,
            File: UserFileChip,
          }}
        />
        <MessagePrimitive.Attachments>
          {({ attachment }) => (
            <div
              key={attachment.id}
              className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/[.12] px-2.5 py-1.5 text-xs"
            >
              <AttachmentIcon attachment={attachment} />
              <span className="max-w-[160px] truncate">{attachment.name}</span>
              {attachment.file ? (
                <span className="text-white/70">
                  {formatFileSize(attachment.file.size)}
                </span>
              ) : null}
            </div>
          )}
        </MessagePrimitive.Attachments>
      </div>
    </MessagePrimitive.Root>
  );
};

/**
 * A product mutated by `add_product`/`update_product`, as returned by the
 * LangGraph agent's portfolio tools (`apps/backend/src/agent/tools.py`).
 */
interface ToolResultProduct {
  name: string;
  amount: number;
  category: Category;
}

type PortfolioToolResult =
  | { status: "added" | "updated"; product: ToolResultProduct }
  | { status: "deleted"; product_id: string }
  | { status: "error"; message: string };

/**
 * Renders a single row for `add_product`/`update_product`/`delete_product`
 * tool calls inside an assistant message (`chat-refinement.spec.md` →
 * "Grouped inline tool result cards"). Consecutive rows visually merge into
 * one card via the `.tool-result-item` adjacency CSS in `globals.css` — no
 * wrapping component needed since assistant-ui renders each tool-call part
 * as an independent sibling.
 */
function parseToolResult<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw as T;
}

function ToolResultItem({
  args,
  result: rawResult,
}: ToolCallMessagePartProps<Record<string, unknown>, PortfolioToolResult>) {
  const result = parseToolResult<PortfolioToolResult>(rawResult);
  if (!result || result.status === "error") return null;

  if (result.status === "deleted") {
    const productId =
      result.product_id ?? (args?.["product_id"] as string | undefined);
    return (
      <div className="tool-result-item">
        <span
          className="tool-badge"
          style={{ background: "var(--danger-light)", color: "var(--danger-text)" }}
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
  const meta = CATEGORY_META[product.category];
  if (!meta) return null;

  return (
    <div className="tool-result-item">
      <span
        className="tool-badge"
        style={{
          background: categoryBgVar(product.category),
          color: categoryTextVar(product.category),
        }}
      >
        {meta.shortLabel}
      </span>
      <span className="tool-item-name truncate">{product.name}</span>
      <span className="tool-item-amount">{formatUsd(product.amount)}</span>
    </div>
  );
}

type ProposedProduct = EnrichedProposedProduct;

type ProposeToolResult =
  | { status: "proposed"; product: ProposedProduct }
  | { status: "error"; message: string };

const proposalInputClass =
  "w-full rounded-md border border-sabbi-neutral-200 bg-white px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none transition-colors focus:border-sabbi-primary";

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
    className: "border-sabbi-neutral-200 bg-sabbi-neutral-100 text-sabbi-neutral-600",
  },
};

/**
 * Card-level reliability badge (`provenance-ui.spec.md` — "Card-Level
 * Reliability Badge"). Falls back to "No verificado" for any unrecognized or
 * missing tag so the card never renders zero badges.
 */
function ReliabilityBadge({ tag }: { tag?: string }) {
  const badge = RELIABILITY_BADGE[tag ?? ""] ?? RELIABILITY_BADGE.unverified;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
      {badge.label}
    </span>
  );
}

/**
 * Small marker next to a field's value distinguishing catalog- from
 * externally-sourced data (`provenance-ui.spec.md` — "Field-Level Source
 * Indicators"). Renders nothing for `catalog` — that is the trusted default
 * and needs no callout.
 */
function FieldSourceMarker({ source }: { source?: FieldSource }) {
  if (!source || source === "catalog") return null;
  const icon = source === "web_search" ? "🌐" : "🤖";
  const label = source === "web_search" ? "Fuente: búsqueda web" : "Fuente: conocimiento de Claude";
  return (
    <span title={label} className="ml-1 text-[10px]">
      {icon}
    </span>
  );
}

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

function ProposeProductCard({
  result,
}: ToolCallMessagePartProps<Record<string, unknown>, ProposeToolResult>) {
  const runtime = useThreadRuntime();
  const [responded, setResponded] = useState<"yes" | "no" | null>(null);

  const parsed = parseToolResult<ProposeToolResult>(result);
  const product = parsed?.status === "proposed" ? parsed.product : null;

  const [name, setName] = useState(product?.name ?? "");
  const [provider, setProvider] = useState(product?.provider ?? "");
  const [amount, setAmount] = useState(product ? String(product.amount) : "0");
  const [category, setCategory] = useState<Category>(product?.category ?? "cash");
  const [subcategory, setSubcategory] = useState(product?.subcategory ?? "");

  if (!product) return null;

  const meta = CATEGORY_META[category];
  if (!meta) return null;

  const provenance = product.provenance;
  const autoClassified = Boolean(product.subcategory);
  const subcategoryGroups = CATEGORY_SUBCATEGORIES[category] ?? [];
  const enrichedFields = ENRICHED_FIELDS.filter(({ key }) => product[key]);

  const parsedAmount = parseFloat(amount);
  const isValid =
    name.trim() !== "" && !isNaN(parsedAmount) && parsedAmount > 0 && subcategory.trim() !== "";

  const handleCategoryChange = (next: Category) => {
    setCategory(next);
    setSubcategory("");
  };

  const handleConfirm = () => {
    if (!isValid) return;
    setResponded("yes");
    const parts: string[] = [
      `nombre: ${name}`,
      `monto: ${parsedAmount}`,
      `categoría: ${category}`,
      `subcategoría: ${subcategory}`,
    ];
    if (provider.trim()) parts.push(`proveedor: ${provider.trim()}`);
    runtime.append({
      role: "user",
      content: [{ type: "text", text: `Sí, agregar al portafolio con: ${parts.join(", ")}.` }],
    });
  };

  const handleReject = () => {
    setResponded("no");
    runtime.append({
      role: "user",
      content: [{ type: "text", text: `No, no agregar "${name}".` }],
    });
  };

  const editable = responded === null;

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-sabbi-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-sabbi-neutral-200 bg-[var(--bg-panel)] px-4 py-2.5 text-xs font-semibold text-sabbi-neutral-700">
        <div className="flex items-center gap-2">
          <span
            className="tool-badge"
            style={{
              background: categoryBgVar(category),
              color: categoryTextVar(category),
            }}
          >
            {meta.shortLabel}
          </span>
          Producto encontrado
        </div>
        <ReliabilityBadge tag={product.reliability_tag} />
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-sabbi-neutral-500">Nombre</span>
          {editable ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={proposalInputClass}
            />
          ) : (
            <span className="text-sm font-semibold text-sabbi-neutral-900">{name}</span>
          )}
        </label>

        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-sabbi-neutral-500">Proveedor</span>
          {editable ? (
            <input
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="Ej: BlackRock, SURA"
              className={proposalInputClass}
            />
          ) : (
            <span className="text-sm text-sabbi-neutral-700">{provider || "—"}</span>
          )}
        </label>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-medium text-sabbi-neutral-500">Monto (USD)</span>
            {editable ? (
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={proposalInputClass}
              />
            ) : (
              <span className="font-display text-lg font-semibold text-[var(--accent-text)]">
                {formatUsd(parsedAmount || 0)}
              </span>
            )}
          </label>

          <label className="flex flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-medium text-sabbi-neutral-500">Categoría</span>
            {editable ? (
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value as Category)}
                className={proposalInputClass}
              >
                {CATEGORY_ORDER.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_META[cat].label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-sabbi-neutral-700">{meta.label}</span>
            )}
          </label>
        </div>

        <label className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-sabbi-neutral-500">
            Subcategoría
            {autoClassified ? (
              <span className="rounded-full bg-sabbi-primary-soft px-1.5 py-0.5 text-[9px] font-semibold text-sabbi-primary">
                Auto-clasificado
              </span>
            ) : null}
          </span>
          {editable ? (
            <select
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className={proposalInputClass}
            >
              <option value="" disabled>
                Seleccionar subcategoría
              </option>
              {subcategoryGroups.map(({ group, leaves }) => (
                <optgroup key={group} label={group}>
                  {leaves.map((leaf) => (
                    <option key={leaf} value={leaf}>
                      {leaf}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          ) : (
            <span className="text-sm text-sabbi-neutral-700">{subcategory || "—"}</span>
          )}
        </label>

        {enrichedFields.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-sabbi-neutral-100 pt-2.5">
            {enrichedFields.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-sabbi-neutral-500">{label}</span>
                <span className="text-sm text-sabbi-neutral-700">
                  {product[key]}
                  <FieldSourceMarker source={provenance?.[key]} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {responded === null ? (
        <div className="flex gap-2 border-t border-sabbi-neutral-200 px-4 py-2.5">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isValid}
            className="flex-1 rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-sabbi-primary-hover disabled:opacity-40"
          >
            Sí, agregar
          </button>
          <button
            type="button"
            onClick={handleReject}
            className="flex-1 rounded-lg border border-sabbi-neutral-300 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 transition-colors hover:bg-sabbi-neutral-50"
          >
            No
          </button>
        </div>
      ) : (
        <div className="border-t border-sabbi-neutral-200 px-4 py-2 text-xs text-sabbi-neutral-500">
          {responded === "yes" ? "✓ Confirmado" : "✗ Descartado"}
        </div>
      )}
    </div>
  );
}

const MarkdownText: FC = () => (
  <MarkdownTextPrimitive className="assistant-markdown" remarkPlugins={[remarkGfm]} />
);

const ThinkingIndicator: FC<EmptyMessagePartProps> = ({ status }) => {
  if (status.type !== "running") return null;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="thinking-dot" />
      <span className="text-sm text-sabbi-neutral-500">Pensando...</span>
    </div>
  );
};

const ReasoningPart: FC<ReasoningMessagePartProps> = ({ text, status }) => {
  const [open, setOpen] = useState(false);
  const isStreaming = status?.type === "running";

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-sabbi-neutral-600 hover:text-sabbi-neutral-900"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
        {isStreaming ? (
          <span className="flex items-center gap-1.5">
            <span className="thinking-dot" />
            Pensando...
          </span>
        ) : (
          "Ver razonamiento"
        )}
      </button>
      {(open || isStreaming) && text ? (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-sabbi-neutral-200 bg-[var(--bg-panel)] px-3 py-2 text-xs leading-relaxed text-sabbi-neutral-600">
          {text}
        </div>
      ) : null}
    </div>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="mr-auto flex w-full min-w-0 flex-col items-start gap-1">
      <div className="min-w-0 max-w-full px-0 py-2 text-sabbi-neutral-900">
        <MessagePrimitive.Content
          components={{
            Text: MarkdownText,
            Empty: ThinkingIndicator,
            Reasoning: ReasoningPart,
            tools: {
              by_name: {
                propose_product: ProposeProductCard,
                add_product: ToolResultItem,
                update_product: ToolResultItem,
                delete_product: ToolResultItem,
              },
              Fallback: () => null,
            },
          }}
        />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-2 flex flex-col gap-2 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-700">
            <ErrorPrimitive.Message />
            <ActionBarPrimitive.Root>
              <ActionBarPrimitive.Reload className="w-fit text-xs font-medium underline">
                Retry
              </ActionBarPrimitive.Reload>
            </ActionBarPrimitive.Root>
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-[20px] border border-sabbi-neutral-200 bg-[var(--bg-panel)] px-3 py-2 transition-colors focus-within:border-sabbi-primary focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(67,56,202,0.08)]">
        <ComposerPrimitive.Attachments>
          {({ attachment }) => (
            <div
              key={attachment.id}
              className="animate-card-enter group/att relative flex w-28 flex-col items-center gap-1 rounded-xl border border-sabbi-neutral-200 bg-white p-3 shadow-sm"
            >
              <AttachmentPrimitive.Remove className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-sabbi-neutral-700 text-[10px] leading-none text-white transition-opacity hover:bg-sabbi-neutral-900">
                ✕
              </AttachmentPrimitive.Remove>
              <div className="flex size-10 items-center justify-center rounded-lg bg-sabbi-neutral-100 text-sabbi-neutral-600">
                <AttachmentIcon attachment={attachment} size={22} />
              </div>
              <span className="w-full truncate text-center text-[11px] font-medium text-sabbi-neutral-900">
                {attachment.name}
              </span>
              <span className="text-[10px] text-sabbi-neutral-600">
                {attachment.file
                  ? formatFileSize(attachment.file.size)
                  : fileExtension(attachment.name)}
              </span>
            </div>
          )}
        </ComposerPrimitive.Attachments>

        <div className="flex items-end gap-2">
          <ComposerPrimitive.AddAttachment
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sabbi-neutral-600 transition-colors hover:bg-sabbi-neutral-100"
            aria-label="Adjuntar archivo"
          >
            <ClipIcon size={18} />
          </ComposerPrimitive.AddAttachment>

          <ComposerPrimitive.Input
            placeholder="Contame sobre tus inversiones..."
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
          />

          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sabbi-primary text-white disabled:opacity-40">
              <SendIcon size={16} />
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel className="rounded-lg border border-sabbi-neutral-300 px-3 py-1.5 text-sm">
              Cancel
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
};
