import type { FC } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { RobotIcon } from "@/components/icons/Icons";

/**
 * Left panel container for the chat. Pins its own header at the top and
 * lets `Thread` own the scrollable message area + pinned input
 * (`portfolio-dashboard.spec.md` → "el chat header permanece fijo ... el
 * chat input permanece fijo").
 */
export const ChatPanel: FC = () => {
  return (
    <div className="flex h-full min-h-0 min-w-[300px] flex-col border-r border-sabbi-neutral-200 bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-sabbi-neutral-200 px-4 py-3">
        <RobotIcon size={20} className="text-sabbi-primary" />
        <span className="text-sm font-semibold text-sabbi-neutral-900">
          Asistente SABBI
        </span>
      </div>
      <Thread />
    </div>
  );
};
