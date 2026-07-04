# Tasks: Bootstrap Assistant Monorepo

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,500-2,500 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 foundation → PR 2 backend → PR 3 frontend → PR 4 CI/deploy docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Workspace foundation | PR 1 | Root scripts, shared placeholder, env examples. |
| 2 | Configurable backend | PR 2 | Depends on PR 1; includes pytest/ruff, no “no tests found” pass. |
| 3 | Assistant frontend | PR 3 | Depends on PR 2 contract; includes build/lint wiring. |
| 4 | CI/deploy foundation | PR 4 | Depends on app scripts; templates and docs. |

## Phase 1: Workspace Foundation

- [x] 1.1 Create `package.json`, `turbo.json`, and `Makefile` with install, dev, build, lint, backend, and web commands.
- [x] 1.2 Create `packages/shared/package.json` as an optional empty workspace that installs cleanly.
- [x] 1.3 Create `.gitignore`, `.env.example`, `apps/web/.env.example`, and `apps/backend/.env.example` documenting required local values.

## Phase 2: Configurable LangGraph Backend

- [ ] 2.1 Create `apps/backend/pyproject.toml`, `requirements.txt`, `package.json`, and `langgraph.json` exposing graph id `agent`.
- [ ] 2.2 Create `apps/backend/src/agent/state.py`, `models.py`, `nodes.py`, and `graph.py` with env-selected OpenAI plus Anthropic-ready provider wiring.
- [ ] 2.3 Add clear missing-config errors naming variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, or `LLM_MODEL` without printing values.
- [ ] 2.4 Add `apps/backend/tests/` pytest coverage for provider selection, missing config, no-secret errors, and graph import/compile.

## Phase 3: Assistant Frontend Runtime

- [ ] 3.1 Create `apps/web/` Next.js App Router setup with TypeScript, Tailwind, assistant-ui dependencies, and standalone output.
- [ ] 3.2 Implement `apps/web/lib/chatApi.ts`, `apps/web/app/assistant.tsx`, and `apps/web/app/page.tsx` for LangGraph streaming chat.
- [ ] 3.3 Implement `apps/web/app/api/[...path]/route.ts` proxy that injects server-side `LANGCHAIN_API_KEY` and preserves streaming bodies.
- [ ] 3.4 Add assistant-ui thread components and recoverable backend-unavailable error behavior.

## Phase 4: CI, Deployment, and Verification

- [ ] 4.1 Create `apps/web/Dockerfile`, `apps/web/ecosystem.config.js`, and `apps/backend/Dockerfile` for template-ready production containers.
- [ ] 4.2 Create `.github/workflows/ci.yml` running frontend lint/build and backend ruff/pytest; fail if backend tests are absent.
- [ ] 4.3 Create deploy workflow templates for frontend and backend using GitHub secrets only, with no committed credentials.
- [ ] 4.4 Verify `yarn lint`, `yarn build`, backend `ruff check`, backend `pytest`, and document manual `yarn dev` chat streaming checks.
