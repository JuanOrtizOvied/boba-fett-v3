/**
 * Cross-component signal used to refetch the portfolio the moment a chat
 * turn finishes streaming — `MyAssistant` (chat) and `PortfolioPanel` /
 * `PortfolioSummary` (portfolio) are sibling components under `page.tsx`
 * with no shared React state, so a `window` custom event is the simplest
 * bridge between them (T-500 — Phase 5 Integration & Polish).
 *
 * `usePortfolio`'s existing 5s poll remains as a safety net (e.g. a tool
 * call by another browser tab/session), but this event makes same-tab
 * agent-driven changes appear immediately instead of waiting for the poll.
 */
export const PORTFOLIO_REFETCH_EVENT = "sabbi:portfolio-refetch";

export function dispatchPortfolioRefetch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PORTFOLIO_REFETCH_EVENT));
}
