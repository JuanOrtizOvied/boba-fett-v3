"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useLangGraphRuntime,
  unstable_createLangGraphStream,
} from "@assistant-ui/react-langgraph";
import { Thread } from "@/components/assistant-ui/thread";
import { createClient } from "@/lib/chatApi";

const ASSISTANT_ID =
  process.env["NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID"] || "agent";

export function MyAssistant() {
  const client = useMemo(() => createClient(), []);

  const stream = useMemo(
    () =>
      unstable_createLangGraphStream({
        client,
        assistantId: ASSISTANT_ID,
      }),
    [client],
  );

  const runtime = useLangGraphRuntime({
    unstable_allowCancellation: true,
    stream,
    create: async () => {
      const { thread_id } = await client.threads.create();
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await client.threads.getState<{
        messages: import("@assistant-ui/react-langgraph").LangChainMessage[];
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
      <Thread />
    </AssistantRuntimeProvider>
  );
}
