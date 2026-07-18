"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type MessageContentBlock = {
  type?: string;
  text?: string;
};

type AdminThreadMessage = {
  id?: string;
  type: string;
  content: string | MessageContentBlock[] | null;
};

/**
 * Flattens LangChain message content to a plain string for display. Content
 * may be a plain string or a list of content blocks (text/image/file/
 * tool_use/etc) — non-text blocks are summarized by their `type` since this
 * viewer is read-only and doesn't need to render rich attachments.
 */
function extractText(content: AdminThreadMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block.text ? block.text : `[${block.type ?? "content"}]`))
    .join(" ");
}

const ROLE_LABEL: Record<string, string> = {
  human: "Usuario",
  ai: "Asistente",
  tool: "Herramienta",
  system: "Sistema",
};

/**
 * Read-only message history for a single thread (`admin-panel/spec.md` ->
 * "Admin views a user's chat thread"). No composer/input renders here — the
 * admin can read the conversation but never post as its owner.
 */
export default function AdminThreadViewPage() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;
  const [messages, setMessages] = useState<AdminThreadMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/admin/threads/${threadId}`);
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Conversación</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {messages === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : messages && messages.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">
          Esta conversación todavía no tiene mensajes.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {messages?.map((message, index) => (
            <div
              key={message.id ?? index}
              className={`max-w-2xl rounded-xl border border-sabbi-neutral-200 bg-background p-3 ${
                message.type === "human" ? "self-end" : "self-start"
              }`}
            >
              <p className="mb-1 text-xs font-medium text-sabbi-neutral-600">
                {ROLE_LABEL[message.type] ?? message.type}
              </p>
              <p className="text-sm whitespace-pre-wrap text-sabbi-neutral-900">
                {extractText(message.content) || "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
