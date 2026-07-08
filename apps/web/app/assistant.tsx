"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useLangGraphRuntime,
  type LangChainMessage,
  type LangGraphStreamCallback,
} from "@assistant-ui/react-langgraph";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { attachmentAdapter } from "@/components/assistant-ui/thread";
import { createClient } from "@/lib/chatApi";
import { useAuth } from "@/components/auth/AuthProvider";
import { dispatchPortfolioRefetch } from "@/lib/portfolioEvents";

const ASSISTANT_ID =
  process.env["NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID"] || "agent";

export function MyAssistant() {
  const client = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const userId = user?.id ?? "";

  // Custom stream callback (based on `unstable_createLangGraphStream`) that
  // always injects `configurable.user_id` into the run config, so every
  // portfolio tool call (add/update/delete_product) is scoped to the
  // signed-in user regardless of per-message `runConfig` (`design.md` —
  // "LangGraph user scoping").
  const stream = useMemo<LangGraphStreamCallback<LangChainMessage>>(
    () => async (messages, config) => {
      const { externalId } = await config.initialize();
      if (!externalId) throw new Error("Thread has not been initialized.");

      // Message editing/regeneration (`getCheckpointId`) is not wired in this
      // runtime, so `config.checkpointId` is always undefined here — no
      // `checkpoint` field to forward.
      const rawStream = client.runs.stream(externalId, ASSISTANT_ID, {
        input: messages.length ? { messages } : null,
        streamMode: ["messages", "updates", "custom"],
        signal: config.abortSignal,
        onDisconnect: "cancel",
        config: { configurable: { user_id: userId } },
        ...(config.command != null && { command: config.command }),
      });

      // Wrap the raw stream so the portfolio panel (a sibling component,
      // not reachable via props/context from here) refetches the instant
      // the run settles — whether it finishes normally, errors, or is
      // cancelled — instead of waiting for `usePortfolio`'s poll interval
      // (T-500 — Phase 5 Integration & Polish).
      return (async function* () {
        try {
          for await (const event of rawStream) {
            yield event;
          }
        } finally {
          dispatchPortfolioRefetch();
        }
      })();
    },
    [client, userId],
  );

  const runtime = useLangGraphRuntime({
    unstable_allowCancellation: true,
    stream,
    adapters: {
      attachments: attachmentAdapter,
    },
    create: async () => {
      // `metadata.owner_user_id` lets `/admin/threads` and any future
      // per-user thread listing filter via the LangGraph SDK's native
      // metadata search (`design.md` — "Thread ownership").
      const { thread_id } = await client.threads.create({
        metadata: { owner_user_id: userId },
      });
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await client.threads.getState<{
        messages: LangChainMessage[];
      }>(externalId);
      return {
        messages: state.values.messages ?? [],
      };
    },
    eventHandlers: {
      // Surface stream-level failures (e.g. the backend is unreachable) so
      // they aren't silently swallowed. assistant-ui already renders a
      // recoverable error on the affected message via MessagePrimitive.Error;
      // this hook is a hook point for additional telemetry/logging.
      onError: (error) => {
        console.error("[assistant] LangGraph stream error", error);
      },
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatPanel />
    </AssistantRuntimeProvider>
  );
}
