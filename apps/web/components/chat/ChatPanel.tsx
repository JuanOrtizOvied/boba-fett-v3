import type { FC } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { RobotIcon } from "@/components/icons/Icons";

const HistoryLoader: FC = () => (
  <div className="flex flex-1 flex-col items-center justify-center gap-5">
    <div className="relative flex items-center justify-center">
      <span
        className="absolute size-16 animate-ping rounded-full opacity-20"
        style={{ background: "var(--sabbi-green)" }}
      />
      <span
        className="absolute size-12 animate-pulse rounded-full opacity-30"
        style={{ background: "var(--sabbi-green)" }}
      />
      <div
        className="relative flex size-14 items-center justify-center rounded-full text-white shadow-lg"
        style={{ background: "var(--sabbi-green)" }}
      >
        <RobotIcon size={28} />
      </div>
    </div>

    <div className="flex flex-col items-center gap-2">
      <span className="text-sm font-medium text-sabbi-neutral-700">
        Cargando historial
      </span>
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-[var(--sabbi-green)]"
            style={{
              animation: "chat-loader-bounce 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
    </div>

    <style>{`
      @keyframes chat-loader-bounce {
        0%, 80%, 100% { opacity: 0.3; transform: scale(1); }
        40% { opacity: 1; transform: scale(1.6); }
      }
    `}</style>
  </div>
);

export const ChatPanel: FC<{ isLoadingHistory?: boolean }> = ({
  isLoadingHistory,
}) => {
  return (
    <div className="flex h-full min-h-0 min-w-[300px] flex-col border-r border-sabbi-neutral-200 bg-background">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-sabbi-neutral-200 px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full text-white" style={{ background: "var(--sabbi-green)" }}>
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
      {isLoadingHistory ? <HistoryLoader /> : <Thread />}
    </div>
  );
};
