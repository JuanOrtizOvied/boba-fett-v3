# Design: Bootstrap Assistant Monorepo

## Technical Approach

Bootstrap the repository from its current OpenSpec-only state into the `CLAUDE.md` blueprint: a Yarn/Turborepo workspace with a Next.js assistant-ui frontend and Python LangGraph backend. The local MVP prioritizes `yarn dev`, streaming chat, env-driven model selection, and build/lint gates; Docker and GitHub Actions are added as template-ready foundations with no committed secrets.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Workspace orchestration | Root Yarn workspaces plus Turborepo scripts | Separate repos; npm-only scripts | Matches blueprint, lets one command run web/backend, and keeps future shared packages possible. |
| Frontend runtime | Next.js App Router with assistant-ui LangGraph runtime | Custom chat UI; direct fetch-only UI | assistant-ui provides streaming/thread primitives and reduces MVP UI risk. Use current `useLangGraphRuntime` stream callback pattern instead of relying on older unstable helpers. |
| Backend graph | Minimal LangGraph `StateGraph` with `messages` state and one chatbot node | LangChain chain only; custom FastAPI app | LangGraph satisfies thread/stream integration and leaves clear extension points for nodes/tools. |
| Model configuration | Provider/model selected via backend env and small model factory | Hard-coded OpenAI model | Meets configurable-backend spec and isolates credential validation from graph logic. |
| Production shape | Next.js standalone Docker + PM2; backend Docker with LangGraph API server/Gunicorn+Uvicorn foundation | Static export; single-process demo containers | Keeps API proxy and streaming viable while remaining deployment-template safe. |

## Data Flow

```text
Browser Thread UI
  └─ assistant-ui runtime
      └─ @langchain/langgraph-sdk Client
          ├─ dev: http://localhost:2024
          └─ prod: Next.js /api/[...path] proxy ──→ LangGraph API
                                                └─ graph chatbot node ──→ configured LLM
```

When the backend is unavailable, frontend runtime errors must surface as recoverable UI errors through assistant-ui message/runtime error states rather than silent failure.

## File Changes

| File | Action | Description |
|---|---|---|
| `package.json`, `turbo.json`, `Makefile` | Create | Root workspace, dev/build/lint scripts, install helpers. |
| `apps/web/**` | Create | Next.js app, assistant runtime, LangGraph client, proxy route, assistant-ui components, env examples. |
| `apps/backend/**` | Create | Python package, `langgraph.json`, graph/state/nodes/model config, env examples, package script. |
| `packages/shared/package.json` | Create | Empty optional workspace placeholder. |
| `.github/workflows/{ci,deploy-frontend,deploy-backend}.yml` | Create | Quality checks and secret-driven deployment templates. |
| `.gitignore`, `.env.example` | Create/modify | Ignore secrets/build outputs and document required env values. |

## Interfaces / Contracts

Frontend env:

```env
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
LANGGRAPH_API_URL=http://localhost:2024
LANGCHAIN_API_KEY=
```

Backend env:

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
LANGSMITH_API_KEY=
```

Backend contract: `langgraph.json` exposes graph id `agent` at `./src/agent/graph.py:graph`; state contains `messages: Annotated[list[AnyMessage], add_messages]`. Missing provider/model credentials must raise clear errors naming the missing variable without printing values.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Backend provider/model factory and missing-env errors | Pytest for env matrix and no-secret error messages. |
| Integration | Graph responds with configured model; frontend builds with runtime wiring | `langgraph dev` smoke path where possible; `yarn build`; backend import/compile test. |
| E2E/manual | `yarn dev` starts web `:3000` and backend `:2024`; chat streams | Manual browser verification documented until browser test tooling exists. |
| CI | Lint/build gates | GitHub Actions run frontend lint/build and backend ruff/pytest. |

## Migration / Rollout

No data migration required. Rollout is file-only: add scaffold, install dependencies, populate local env files from examples, run `yarn dev`, then verify build/lint. Deployment workflows remain dormant until GitHub secrets and AWS resources are configured.

## Open Questions

- [ ] Which non-OpenAI providers must be supported in the first implementation beyond Anthropic-ready dependency wiring?
- [ ] Should CI require backend tests to exist immediately, or allow an explicit “no tests found” bootstrap pass?
