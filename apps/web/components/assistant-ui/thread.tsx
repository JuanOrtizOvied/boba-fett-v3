"use client";

import type { FC } from "react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from "@assistant-ui/react";

/**
 * Chat thread UI wired to the LangGraph runtime.
 *
 * Backend-unavailable / stream failures surface as a recoverable error on
 * the affected assistant message (via MessagePrimitive.Error) instead of
 * failing silently, with a Retry action so the user can resume the chat.
 */
export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col bg-background">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
        <ThreadPrimitive.If empty>
          <div className="m-auto flex max-w-md flex-col gap-2 text-center text-foreground/70">
            <p className="text-lg font-medium">Say hello to your assistant</p>
            <p className="text-sm">
              Messages stream back from the LangGraph backend in real time.
            </p>
          </div>
        </ThreadPrimitive.If>

        <ThreadPrimitive.Messages>
          {({ message }) => {
            if (message.role === "user") return <UserMessage />;
            if (message.role === "assistant") return <AssistantMessage />;
            return null;
          }}
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-foreground/10 px-4 py-4">
        <Composer />
      </div>
    </ThreadPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
      <div className="rounded-2xl bg-foreground px-4 py-2 text-background">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="mr-auto flex max-w-[80%] flex-col items-start gap-1">
      <div className="rounded-2xl bg-foreground/5 px-4 py-2">
        <MessagePrimitive.Content />
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
    <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-foreground/20 px-3 py-2">
      <ComposerPrimitive.Input
        placeholder="Send a message..."
        rows={1}
        className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
      />
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send className="rounded-lg bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-40">
          Send
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel className="rounded-lg border border-foreground/30 px-3 py-1.5 text-sm">
          Cancel
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  );
};
