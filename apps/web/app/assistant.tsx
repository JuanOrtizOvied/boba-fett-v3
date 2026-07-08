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
import { createThreadListAdapter } from "@/lib/threadListAdapter";
import { useAuth } from "@/components/auth/AuthProvider";
import { dispatchPortfolioRefetch } from "@/lib/portfolioEvents";

const ASSISTANT_ID =
  process.env["NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID"] || "agent";

export function MyAssistant() {
  const client = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const threadListAdapter = useMemo(
    () => createThreadListAdapter(client, userId),
    [client, userId],
  );

  const stream = useMemo<LangGraphStreamCallback<LangChainMessage>>(
    () => async (messages, config) => {
      const { externalId } = await config.initialize();
      if (!externalId) throw new Error("Thread has not been initialized.");

      const rawStream = client.runs.stream(externalId, ASSISTANT_ID, {
        input: messages.length ? { messages } : null,
        streamMode: ["messages", "updates", "custom"],
        signal: config.abortSignal,
        onDisconnect: "cancel",
        config: { configurable: { user_id: userId } },
        ...(config.command != null && { command: config.command }),
      });

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
    unstable_threadListAdapter: threadListAdapter,
    stream,
    adapters: {
      attachments: attachmentAdapter,
    },
    load: async (externalId) => {
      try {
        const state = await client.threads.getState<{
          messages: LangChainMessage[];
        }>(externalId);
        return {
          messages: state.values?.messages ?? [],
        };
      } catch {
        return { messages: [] };
      }
    },
    eventHandlers: {
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
