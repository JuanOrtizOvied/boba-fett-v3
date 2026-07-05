# Proposal: Bootstrap Assistant Monorepo

## Intent

Turn the current bootstrap-only repository into a runnable AI assistant monorepo described by `CLAUDE.md`: Next.js + assistant-ui frontend, configurable LangGraph backend, local development workflow, and deployment foundation.

## Scope

### In Scope
- Create the monorepo scaffold with Yarn workspaces, Turborepo, `apps/web`, `apps/backend`, and optional shared package structure.
- Implement a local MVP where the web app streams chat through a LangGraph backend.
- Make backend provider/model configurable through environment variables.
- Add Dockerfiles, GitHub Actions CI, and deployment workflow foundations.

### Out of Scope
- Production infrastructure provisioning in AWS.
- Authentication, persistence beyond LangGraph local dev state, custom tools, or domain-specific agent behavior.
- Full test suite coverage before tooling exists.

## Capabilities

### New Capabilities
- `assistant-monorepo-foundation`: runnable workspace layout, package manifests, and shared project scripts.
- `assistant-chat-runtime`: browser assistant UI connected to LangGraph streaming chat.
- `configurable-langgraph-backend`: backend graph with provider/model selected from environment configuration.
- `local-dev-workflow`: one-command local startup and documented install/dev commands.
- `cicd-deployment-foundation`: lint/build CI plus Docker and deploy workflow templates.

### Modified Capabilities
- None.

## Approach

Use `CLAUDE.md` as the source blueprint. Build the smallest working scaffold first: root workspace scripts, Next.js assistant UI, Python LangGraph app, env examples, Dockerfiles, and CI workflows. Keep deployment workflows template-ready and secret-driven, not coupled to real AWS resources.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `package.json`, `turbo.json`, `Makefile` | New | Workspace orchestration and commands. |
| `apps/web/` | New | Next.js assistant-ui frontend and API proxy. |
| `apps/backend/` | New | LangGraph Python backend and config. |
| `.github/workflows/` | New | CI and deploy workflow foundations. |
| `openspec/changes/bootstrap-assistant-monorepo/` | New | SDD proposal and future specs/design/tasks. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dependency/version drift from `CLAUDE.md` examples | Med | Verify current package APIs during design/apply. |
| CI/CD secrets or AWS resources unavailable | Med | Keep deploy workflows configurable and non-blocking for local MVP. |
| Provider configuration leaks secrets | Low | Use env examples only; do not commit real credentials. |

## Rollback Plan

Revert this change folder and generated bootstrap files (`apps/`, `packages/`, root manifests, Dockerfiles, workflows). Since no data migration is planned, rollback is file-only.

## Dependencies

- Node.js >= 20, Yarn, Python >= 3.11, LangSmith/OpenAI or supported provider keys for runtime use.

## Success Criteria

- [ ] `yarn dev` starts frontend and backend locally.
- [ ] Browser chat streams responses from the LangGraph backend.
- [ ] Backend provider/model can be changed through environment variables.
- [ ] `yarn build` and `yarn lint` pass.
