"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { attachmentAdapter } from "@/components/assistant-ui/thread";
import { useAuth } from "@/components/auth/AuthProvider";
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
  | { event: "thinking"; data: { status: string } }
  | { event: "text"; data: { content: string } }
  | { event: "final"; data: ThreadStateResponse }
  | { event: "done"; data: unknown }
  | { event: "error"; data: { detail: string } };

// -- Message conversion ---------------------------------------------------

type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue };

function convertMessages(api: ApiMessage[]): ThreadMessageLike[] {
  const result: ThreadMessageLike[] = [];
  const toolResults = new Map<string, JSONValue>();

  // Collect tool results first so we can merge them into tool-call parts
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
      const parts: { type: "text"; text: string }[] = [];
      if (typeof msg.content === "string") {
        parts.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const b of msg.content as { type?: string; text?: string }[]) {
          if (b.type === "text" && b.text) parts.push({ type: "text", text: b.text });
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
    // Tool messages are merged into the preceding assistant message above
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

// -- Component ------------------------------------------------------------

export function MyAssistant() {
  const { user } = useAuth();
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

  // Hydrate thread on mount
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

  // Send a message via FastAPI SSE
  const onNew = useCallback(
    async (append: AppendMessage) => {
      if (!threadId || isRunning) return;

      const textPart = append.content.find((p) => p.type === "text");
      const text = textPart && "text" in textPart ? textPart.text.trim() : "";
      if (!text) return;

      // Build attachment content blocks for the API
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

      const userMsg: ThreadMessageLike = {
        role: "user",
        id: `user-${Date.now()}`,
        content: [{ type: "text", text }],
      };
      const streamingId = `assistant-${Date.now()}`;
      const streamingMsg: ThreadMessageLike = {
        role: "assistant",
        id: streamingId,
        content: [{ type: "text", text: "" }],
      };

      updateMessages([...msgsRef.current, userMsg, streamingMsg]);
      setIsRunning(true);

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
            const final = ev.data as ThreadStateResponse;
            if (final?.messages) updateMessages(convertMessages(final.messages));
          }

          if (ev.event === "error") {
            const detail = (ev.data as { detail?: string })?.detail;
            console.error("[assistant] stream error:", detail);
          }
        }
      } catch (err) {
        console.error("[assistant] stream failed:", err);
        updateMessages(
          msgsRef.current.filter((m) => m.id !== streamingId),
        );
      } finally {
        setIsRunning(false);
        dispatchPortfolioRefetch();
      }
    },
    [threadId, isRunning, updateMessages],
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
