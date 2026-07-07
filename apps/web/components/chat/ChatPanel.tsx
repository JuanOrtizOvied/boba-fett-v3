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
      <div className="flex shrink-0 items-center gap-2.5 border-b border-sabbi-neutral-200 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7c3aed,#4338ca)] text-white">
          <RobotIcon size={16} />
        </div>
        <div className="flex flex-col">
          <h3 className="text-[13.5px] font-medium text-sabbi-neutral-900">
            Asistente SABBI
          </h3>
          <span
            className="flex items-center gap-1 text-[11.5px]"
            style={{ color: "var(--success)" }}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ background: "var(--success)" }}
            />
            En línea
          </span>
        </div>
      </div>
      <Thread />
    </div>
  );
};
