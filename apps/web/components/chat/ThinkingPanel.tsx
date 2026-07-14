"use client";

import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type FC,
  type ReactNode,
  type SetStateAction,
} from "react";

export interface ProgressStep {
  step: string;
  label: string;
  completed: boolean;
}

export interface ThinkingState {
  steps: ProgressStep[];
  reasoning: string;
  visible: boolean;
}

interface ThinkingContextValue {
  thinking: ThinkingState;
  setThinking: Dispatch<SetStateAction<ThinkingState>>;
}

const ThinkingContext = createContext<ThinkingContextValue | undefined>(
  undefined,
);

export const THINKING_INITIAL: ThinkingState = {
  steps: [],
  reasoning: "",
  visible: false,
};

export const ThinkingProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [thinking, setThinking] = useState<ThinkingState>(THINKING_INITIAL);
  return (
    <ThinkingContext.Provider value={{ thinking, setThinking }}>
      {children}
    </ThinkingContext.Provider>
  );
};

export function useThinking(): ThinkingContextValue {
  const ctx = useContext(ThinkingContext);
  if (!ctx) throw new Error("useThinking must be used within ThinkingProvider");
  return ctx;
}

export const ThinkingPanel: FC = () => {
  const { thinking } = useThinking();
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  if (!thinking.visible || thinking.steps.length === 0) return null;

  const currentStep =
    thinking.steps.findLast((s) => !s.completed) ??
    thinking.steps[thinking.steps.length - 1];

  return (
    <div className="animate-card-enter mx-auto mb-3 w-full max-w-[640px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm">
      <button
        type="button"
        onClick={() => setStepsExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span
          className="inline-block text-xs text-[var(--text-3)] transition-transform"
          style={{ transform: stepsExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▸
        </span>
        {currentStep.completed ? (
          <span className="text-[var(--success)]">✓</span>
        ) : (
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
        )}
        <span className="font-medium text-[var(--text-2)]">
          {currentStep.label}
        </span>
        <span className="ml-auto text-xs text-[var(--text-3)]">
          {thinking.steps.filter((s) => s.completed).length}/{thinking.steps.length}
        </span>
      </button>

      {stepsExpanded && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-[var(--border)] pt-2">
          {thinking.steps.map((s, i) => (
            <li
              key={`${s.step}-${i}`}
              className="flex items-center gap-2 text-[var(--text-2)]"
            >
              {s.completed ? (
                <span className="text-[var(--success)]">✓</span>
              ) : (
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
              )}
              <span className={s.completed ? "text-[var(--text-3)]" : ""}>
                {s.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {thinking.reasoning && (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <button
            type="button"
            onClick={() => setReasoningExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-[var(--text-3)] hover:text-[var(--text-2)]"
          >
            <span
              className="inline-block transition-transform"
              style={{
                transform: reasoningExpanded ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▸
            </span>
            Razonamiento
          </button>
          {reasoningExpanded && (
            <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--text-3)]">
              {thinking.reasoning}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
