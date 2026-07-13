"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import {
  ThinkingProvider,
  useThinking,
  THINKING_INITIAL,
  type ProgressStep,
} from "@/components/chat/ThinkingPanel";
import { attachmentAdapter } from "@/components/assistant-ui/thread";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { dispatchPortfolioRefetch } from "@/lib/portfolioEvents";

// -- Types ----------------------------------------------------------------

type ApiMessage = {
  id: string;
  type: string;
  content: unknown;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
};

type ThreadStateResponse = {
  thread_id: string;
  messages: ApiMessage[];
};

type StreamEvent =
  | { event: "progress"; data: { step: string; label: string } }
  | { event: "reasoning"; data: { content: string } }
  | { event: "text"; data: { content: string } }
  | { event: "final"; data: ThreadStateResponse }
  | { event: "done"; data: unknown }
  | { event: "error"; data: { detail: string } };

// -- Message conversion ---------------------------------------------------

type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue };

function convertMessages(api: ApiMessage[]): ThreadMessageLike[] {
  const result: ThreadMessageLike[] = [];
  const toolResults = new Map<string, JSONValue>();

  for (const msg of api) {
    if (msg.type === "tool" && msg.tool_call_id) {
      try {
        toolResults.set(
          msg.tool_call_id,
          typeof msg.content === "string" ? JSON.parse(msg.content) : (msg.content as JSONValue),
        );
      } catch {
        toolResults.set(msg.tool_call_id, msg.content as JSONValue);
      }
    }
  }

  for (const msg of api) {
    if (msg.type === "human") {
      type UserPart =
        | { type: "text"; text: string }
        | { type: "image"; image: string }
        | { type: "file"; data: string; mimeType: string; filename?: string };
      const parts: UserPart[] = [];
      if (typeof msg.content === "string") {
        parts.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const b of msg.content as Record<string, unknown>[]) {
          if (b.type === "text" && b.text)
            parts.push({ type: "text", text: b.text as string });
          else if (b.type === "image" || b.type === "document") {
            const src = b.source as
              | { media_type?: string; data?: string }
              | undefined;
            const mime = (src?.media_type as string) ?? "application/octet-stream";
            const title = b.title as string | undefined;
            if (b.type === "image" && src?.data) {
              parts.push({ type: "image", image: `data:${mime};base64,${src.data}` });
            } else {
              const dataUrl = src?.data ? `data:${mime};base64,${src.data}` : "";
              parts.push({ type: "file", data: dataUrl, mimeType: mime, filename: title });
            }
          }
        }
      }
      if (parts.length) result.push({ role: "user", id: msg.id, content: parts });
    } else if (msg.type === "ai") {
      type TextPart = { readonly type: "text"; readonly text: string };
      type ToolCallPart = {
        readonly type: "tool-call";
        readonly toolCallId: string;
        readonly toolName: string;
        readonly args: { readonly [k: string]: JSONValue };
        readonly result?: JSONValue;
      };
      const parts: (TextPart | ToolCallPart)[] = [];

      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          parts.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.args as { readonly [k: string]: JSONValue },
            result: toolResults.get(tc.id),
          });
        }
      }

      if (typeof msg.content === "string" && msg.content) {
        parts.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const b of msg.content as { type?: string; text?: string }[]) {
          if (b.type === "text" && b.text) parts.push({ type: "text", text: b.text });
        }
      }

      if (parts.length) result.push({ role: "assistant", id: msg.id, content: parts });
    }
  }

  return result;
}

// -- SSE parsing ----------------------------------------------------------

function parseSseBlock(block: string): StreamEvent | null {
  const lines = block.split(/\r?\n/);
  const evLine = lines.find((l) => l.startsWith("event:"));
  const dataLines = lines.filter((l) => l.startsWith("data:"));
  if (!evLine || !dataLines.length) return null;

  const event = evLine.slice("event:".length).trim();
  const raw = dataLines.map((l) => l.slice("data:".length).trimStart()).join("\n");
  let data: unknown;
  if (raw === "[DONE]") data = raw;
  else {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }
  return { event, data } as StreamEvent;
}

async function* parseSseStream(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split(/\r?\n\r?\n/);
    buf = blocks.pop() ?? "";
    for (const b of blocks) {
      const ev = parseSseBlock(b);
      if (ev) yield ev;
    }
  }
  buf += decoder.decode();
  if (buf.trim()) {
    const ev = parseSseBlock(buf.trim());
    if (ev) yield ev;
  }
}

// -- API helpers ----------------------------------------------------------

async function saveThreadId(threadId: string) {
  await fetchWithAuth("/api/auth/me/thread", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: threadId }),
  });
}

async function fetchThreadState(
  threadId: string,
): Promise<ThreadStateResponse> {
  const res = await fetchWithAuth(`/api/chat/threads/${threadId}/state`);
  if (!res.ok) return { thread_id: threadId, messages: [] };
  return res.json();
}

// -- Thinking helpers -----------------------------------------------------

function addProgressStep(
  prev: ProgressStep[],
  step: string,
  label: string,
): ProgressStep[] {
  const updated = prev.map((s) => (s.completed ? s : { ...s, completed: true }));
  return [...updated, { step, label, completed: false }];
}

// -- Inner component (needs ThinkingContext) -------------------------------

function AssistantInner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { setThinking } = useThinking();
  const userId = user?.id ?? "";
  const savedThreadId = user?.active_thread_id ?? null;

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessageLike[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const msgsRef = useRef<ThreadMessageLike[]>([]);

  const updateMessages = useCallback(
    (next: readonly ThreadMessageLike[]) => {
      msgsRef.current = [...next];
      setMessages([...next]);
    },
    [],
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      let tid = savedThreadId;
      if (!tid) {
        tid = crypto.randomUUID();
        await saveThreadId(tid);
      }
      if (cancelled) return;
      setThreadId(tid);

      const state = await fetchThreadState(tid);
      if (cancelled) return;
      updateMessages(convertMessages(state.messages));
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, savedThreadId, updateMessages]);

  const onNew = useCallback(
    async (append: AppendMessage) => {
      if (!threadId || isRunning) return;

      const textPart = append.content.find((p) => p.type === "text");
      const text = textPart && "text" in textPart ? textPart.text.trim() : "";
      if (!text) return;

      const attachments: Record<string, unknown>[] | undefined =
        append.attachments
          ?.flatMap((att) =>
            (att.content ?? []).map((c) => {
              if (c.type === "file" && "data" in c) {
                return {
                  type: "file",
                  data: c.data,
                  mime_type: "mimeType" in c ? c.mimeType : "application/octet-stream",
                  metadata: { filename: att.name },
                };
              }
              return null;
            }),
          )
          .filter(Boolean) as Record<string, unknown>[] | undefined;

      const userContent: Array<
        | { type: "text"; text: string }
        | { type: "file"; data: string; mimeType: string; filename: string }
      > = [{ type: "text", text }];
      if (append.attachments?.length) {
        for (const att of append.attachments) {
          userContent.push({
            type: "file",
            data: "",
            mimeType: att.contentType ?? "application/octet-stream",
            filename: att.name,
          });
        }
      }
      const userMsg: ThreadMessageLike = {
        role: "user",
        id: `user-${Date.now()}`,
        content: userContent,
      };
      const streamingId = `assistant-${Date.now()}`;
      const streamingMsg: ThreadMessageLike = {
        role: "assistant",
        id: streamingId,
        content: [{ type: "text", text: "" }],
      };

      updateMessages([...msgsRef.current, userMsg, streamingMsg]);
      setIsRunning(true);
      setThinking({ steps: [], reasoning: "", visible: true });

      try {
        const res = await fetchWithAuth(
          `/api/chat/threads/${threadId}/messages/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: text,
              attachments: attachments?.length ? attachments : undefined,
            }),
          },
        );

        if (!res.ok) throw new Error(`Stream failed: ${res.status}`);

        let streamed = "";

        for await (const ev of parseSseStream(res)) {
          if (ev.event === "progress") {
            const { step, label } = ev.data as { step: string; label: string };
            setThinking((prev) => ({
              ...prev,
              steps: addProgressStep(prev.steps, step, label),
            }));
          }

          if (ev.event === "reasoning") {
            const chunk = (ev.data as { content?: string })?.content ?? "";
            setThinking((prev) => ({
              ...prev,
              reasoning: prev.reasoning + chunk,
            }));
          }

          if (ev.event === "text") {
            const chunk = (ev.data as { content?: string })?.content ?? "";
            streamed += chunk;
            const updated = msgsRef.current.map((m) =>
              m.id === streamingId
                ? { ...m, content: [{ type: "text" as const, text: streamed }] }
                : m,
            );
            updateMessages(updated);
          }

          if (ev.event === "final") {
            setThinking((prev) => ({
              ...prev,
              steps: prev.steps.map((s) => ({ ...s, completed: true })),
              visible: false,
            }));
            const final = ev.data as ThreadStateResponse;
            if (final?.messages) updateMessages(convertMessages(final.messages));
          }

          if (ev.event === "error") {
            const detail =
              (ev.data as { detail?: string })?.detail ??
              "Error al procesar la solicitud";
            toast(detail);
            setThinking(THINKING_INITIAL);
            const updated = msgsRef.current.map((m) =>
              m.id === streamingId
                ? { ...m, content: [{ type: "text" as const, text: `⚠ ${detail}` }] }
                : m,
            );
            updateMessages(updated);
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "No se pudo conectar con el servidor";
        toast(message);
        setThinking(THINKING_INITIAL);
        const updated = msgsRef.current.map((m) =>
          m.id === streamingId
            ? { ...m, content: [{ type: "text" as const, text: `⚠ ${message}` }] }
            : m,
        );
        updateMessages(updated);
      } finally {
        setIsRunning(false);
        setThinking(THINKING_INITIAL);
        dispatchPortfolioRefetch();
      }
    },
    [threadId, isRunning, updateMessages, toast, setThinking],
  );

  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (m) => m,
    setMessages: updateMessages,
    onNew,
    isRunning,
    adapters: {
      attachments: attachmentAdapter,
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatPanel />
    </AssistantRuntimeProvider>
  );
}

// -- Exported wrapper (provides ThinkingContext) ---------------------------

export function MyAssistant() {
  return (
    <ThinkingProvider>
      <AssistantInner />
    </ThinkingProvider>
  );
}
