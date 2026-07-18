# CLAUDE.md — SABBI Portfolio Builder

## Project Overview

This is **SABBI**, an AI-assisted investment portfolio builder. It provides a split-screen **Next.js + assistant-ui** frontend (chat on one side, live portfolio dashboard on the other) backed by a **LangGraph** (Python, Anthropic Claude) conversational agent plus a **FastAPI** REST API — both sharing a **PostgreSQL** database as the single source of truth for portfolio data. The project started from a general-purpose boilerplate template (Yarn workspaces + Turborepo) and was specialized for SABBI via spec-driven development.

The project follows **spec-driven development (SDD)** using [OpenSpec](https://github.com/Fission-AI/OpenSpec/) to align AI and human on requirements before code is written.

---

## OpenSpec Integration

This project uses OpenSpec for structured feature development. After initializing:

```bash
npm install -g @fission-ai/openspec@latest
cd <project-root>
openspec init
```

OpenSpec creates the `openspec/` directory:

```
openspec/
├── specs/              # Source of truth — current system behavior
│   └── <domain>/
│       └── spec.md
├── changes/            # Active proposed changes (one folder per change)
│   └── <change-name>/
│       ├── proposal.md   # Intent and scope
│       ├── specs/         # Delta specs (ADDED/MODIFIED/REMOVED)
│       ├── design.md      # Technical approach
│       └── tasks.md       # Implementation checklist
└── config.yaml         # Project configuration
```

### Development Workflow

Use OpenSpec slash commands to drive feature development:

```
/opsx:propose <feature>  →  Creates proposal + specs + design + tasks
/opsx:apply              →  Implements the tasks against the codebase
/opsx:archive            →  Merges delta specs into source of truth
```

**Before implementing any feature**, always create an OpenSpec change first. Read existing specs in `openspec/specs/` to understand current system behavior. Update specs as you learn during implementation — artifacts are fluid, not rigid.

### Portfolio Agent Specs

The SABBI portfolio builder's delta specs live under `openspec/changes/sabbi-portfolio-agent/specs/`:

- `langgraph-agent.spec.md` — agent state, tools, graph structure, system prompt, streaming, error handling
- `conversation-and-extraction.spec.md` — chat UI, file uploads, document extraction
- `portfolio-dashboard.spec.md` — metrics, category tabs/sections, summary view, Excel export
- `product-cards-crud.spec.md` — product card states, edit modal, delete confirmation

Read these before touching agent, portfolio, or dashboard code — they are the acceptance criteria for this change.

---

## Monorepo Structure

```
boilerplate-template/
├── .github/
│   └── workflows/
│       ├── ci.yml              # Lint + test on every PR
│       ├── deploy-frontend.yml # Docker → ECR → EC2 (PM2)
│       └── deploy-backend.yml  # Docker → ECR → EC2 (Gunicorn+Uvicorn)
├── apps/
│   ├── web/                    # Next.js frontend (assistant-ui)
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── assistant.tsx   # Custom FastAPI SSE assistant runtime
│   │   │   └── api/
│   │   │       └── [...path]/
│   │   │           └── route.ts  # Proxy to FastAPI/LangGraph upstreams
│   │   ├── components/
│   │   │   └── assistant-ui/
│   │   │       ├── thread.tsx
│   │   │       └── thread-list.tsx
│   │   ├── lib/
│   │   │   └── chatApi.ts      # LangGraph SDK client factory
│   │   ├── .env.local
│   │   ├── Dockerfile          # Production image (Node + PM2)
│   │   ├── ecosystem.config.js # PM2 process configuration
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── backend/                # LangGraph Python backend
│       ├── src/
│       │   └── agent/
│       │       ├── __init__.py
│       │       ├── graph.py    # Main graph definition
│       │       ├── nodes.py    # Graph node functions
│       │       ├── state.py    # Agent state schema
│       │       └── tools.py    # Tool definitions
│       ├── langgraph.json      # LangGraph server config
│       ├── Dockerfile          # Production container image
│       ├── pyproject.toml
│       ├── .env
│       └── requirements.txt
├── packages/                   # Shared packages (optional)
│   └── shared/
│       └── package.json
├── openspec/                   # OpenSpec SDD artifacts
│   ├── specs/
│   └── changes/
├── package.json                # Root workspace config (with workspaces field)
├── turbo.json                  # Turborepo pipeline config
├── .env                        # Root-level shared env vars
├── Makefile                    # Unified dev commands
└── CLAUDE.md                   # This file
```

---

## Prerequisites

- **Node.js** >= 20 (LTS recommended)
- **Yarn** >= 4 (Berry) — or Yarn Classic 1.x (`npm install -g yarn`)
- **Python** >= 3.11
- **uv** (recommended) or **pip** for Python dependency management
- **PostgreSQL** >= 14 (local or Docker) — stores portfolio products; see `apps/backend/src/db/schema.sql`
- **Anthropic API key** (Claude) — get one at https://console.anthropic.com
- **OpenSpec** (`npm install -g @fission-ai/openspec@latest`)
- **LangSmith API key** (optional, for LangGraph dev server tracing — get one at https://smith.langchain.com)

---

## Initial Configuration

### 1. Bootstrap the monorepo

```bash
mkdir boilerplate-template && cd boilerplate-template
yarn init -y
```

Add the `workspaces` field to the root `package.json`:

```json
{
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

Install Turborepo at the root:

```bash
yarn add -D turbo
```

### 2. Initialize OpenSpec

```bash
openspec init
```

Select your AI tool (Claude Code) when prompted. This generates the `openspec/` directory and tool-specific instruction files.

### 3. Create `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    }
  }
}
```

### 4. Root `package.json` scripts

```json
{
  "name": "boba-fett-v3",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev --parallel",
    "dev:web": "turbo run dev --filter=web",
    "dev:backend": "turbo run dev --filter=backend",
    "dev:graph": "cd apps/backend && yarn dev:graph",
    "dev:api": "cd apps/backend && yarn dev:api",
    "build": "turbo run build",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2",
    "concurrently": "^9"
  }
}
```

The backend workspace's `dev` script uses `concurrently` to start both the LangGraph agent server (`:2024`) and the FastAPI portfolio API (`:3003`) in parallel. `yarn dev` at the root starts all three services (Next.js + LangGraph + FastAPI) via Turborepo.

---

## Frontend Setup (Next.js + assistant-ui)

### 1. Scaffold the frontend

```bash
cd apps
npx create-assistant-ui@latest -t langgraph web
```

This scaffolds a Next.js app pre-configured with assistant-ui and the LangGraph runtime adapter. If you prefer manual setup, continue below.

### 2. Manual setup (alternative)

```bash
cd apps
yarn create next-app@latest web --typescript --tailwind --eslint --app --src-dir=false
cd web
yarn add @assistant-ui/react @assistant-ui/react-markdown @langchain/langgraph-sdk
npx assistant-ui@latest init
```

### 3. Environment variables (`apps/web/.env.local`)

```env
# Current SABBI frontend traffic goes through the Next.js `/api` proxy.
# `/api/chat/*`, `/api/auth/*`, `/api/portfolio/*`, `/api/products/*`, and
# `/api/admin/*` are routed to FastAPI.
PORTFOLIO_API_URL=http://localhost:3003

# LangGraph fallback/proxy target for SDK routes that are not FastAPI paths.
LANGGRAPH_API_URL=http://localhost:2024

# Legacy scaffold helper. The current chat runtime does not require this.
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent

# For production (uncomment and fill in):
# LANGCHAIN_API_KEY=your_langsmith_api_key
# LANGGRAPH_API_URL=your_production_langgraph_cloud_url
```

### 4. Chat runtime (`apps/web/app/assistant.tsx`)

The current SABBI chat runtime is custom. It uses `useExternalStoreRuntime` from `@assistant-ui/react`, persists the active thread ID on the authenticated user, and streams responses from FastAPI:

```text
POST /api/chat/threads/:threadId/messages/stream
```

Do not rebuild the active chat flow with the old scaffolded `useLangGraphRuntime` example unless the product intentionally moves back to direct LangGraph SDK streaming.

### 5. Legacy LangGraph SDK helper (`apps/web/lib/chatApi.ts`)

`createClient()` still exists for compatibility with earlier scaffolded code, but the main chat UI does not use it. Treat it as a helper for LangGraph SDK routes, not as the source of truth for SABBI chat.

### 6. API proxy route (`apps/web/app/api/[...path]/route.ts`)

The proxy splits traffic by path prefix:

| Path prefix | Upstream |
|-------------|----------|
| `/auth/*`, `/portfolio/*`, `/products/*`, `/admin/*`, `/chat/*` | FastAPI via `PORTFOLIO_API_URL` |
| Everything else | LangGraph via `LANGGRAPH_API_URL` |

It injects `LANGCHAIN_API_KEY` only for LangGraph requests, forwards auth cookies to FastAPI, preserves multiple `Set-Cookie` headers, and returns a JSON `502` when the selected upstream is unreachable.

### 7. Page entry point (`apps/web/app/page.tsx`)

```tsx
import { MyAssistant } from "./assistant";

export default function Home() {
  return (
    <div className="h-dvh">
      <MyAssistant />
    </div>
  );
}
```

### 8. Frontend `package.json` scripts

Ensure `apps/web/package.json` includes:

```json
{
  "name": "web",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

---

## Backend Setup (LangGraph / Python)

### 1. Create the backend directory

```bash
mkdir -p apps/backend/src/agent
cd apps/backend
```

### 2. `pyproject.toml`

```toml
[project]
name = "sabbi-backend"
version = "0.1.0"
description = "SABBI portfolio agent backend (LangGraph + FastAPI)"
requires-python = ">=3.11"
dependencies = [
    "langgraph>=0.4",
    "langchain-core>=0.3",
    "langchain-anthropic>=0.3",
    "langgraph-cli[inmem]>=0.1.55",
    "asyncpg>=0.29",
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "openpyxl>=3.1",
]

[build-system]
requires = ["setuptools>=75"]
build-backend = "setuptools.build_meta"
```

### 3. `langgraph.json`

```json
{
  "$schema": "https://langgra.ph/schema.json",
  "dependencies": ["."],
  "graphs": {
    "agent": "./src/agent/graph.py:graph"
  },
  "env": ".env"
}
```

### 4. Agent state (`apps/backend/src/agent/state.py`)

```python
from typing import Annotated
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages
from langchain_core.messages import AnyMessage


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
```

### 5. Graph definition (`apps/backend/src/agent/graph.py`)

```python
from langgraph.graph import StateGraph, START, END
from langchain_anthropic import ChatAnthropic
from agent.state import AgentState


llm = ChatAnthropic(model="claude-sonnet-4-20250514", temperature=0)


async def chatbot(state: AgentState) -> AgentState:
    response = await llm.ainvoke(state["messages"])
    return {"messages": [response]}


builder = StateGraph(AgentState)
builder.add_node("chatbot", chatbot)
builder.add_edge(START, "chatbot")
builder.add_edge("chatbot", END)

graph = builder.compile()
```

The real SABBI graph (`apps/backend/src/agent/graph.py`) extends this minimal
shape with `router` → (`process_document` | `agent`) → (`tools` | `END`)
routing and a `ToolNode(portfolio_tools)` that writes portfolio changes
straight to Postgres — see `agent/tools.py` and `db/repository.py`.

### 6. Backend environment (`apps/backend/.env`)

```env
ANTHROPIC_API_KEY=sk-ant-your_anthropic_api_key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sabbi
LANGSMITH_API_KEY=your_langsmith_api_key

# Optional — enable LangSmith tracing
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=sabbi-portfolio-agent
```

### 7. Install Python dependencies

```bash
cd apps/backend
pip install -e ".[dev]"
# — or with uv —
uv pip install -e ".[dev]"
```

### 8. Backend `package.json` scripts

Create `apps/backend/package.json` so Turborepo can orchestrate it. The `dev` script runs both the LangGraph agent server and the FastAPI portfolio API in parallel:

```json
{
  "name": "backend",
  "private": true,
  "scripts": {
    "dev": "concurrently -n graph,api -c blue,green \"yarn dev:graph\" \"yarn dev:api\"",
    "dev:graph": "langgraph dev --host 0.0.0.0 --port 2024 --no-browser",
    "dev:api": "uvicorn api.routes:app --app-dir src --reload --port 3003",
    "lint": "ruff check src/",
    "test": "pytest -q"
  }
}
```

---

## Running Everything with One Command

### Option A: Turborepo (recommended)

```bash
# From the repo root — starts all 3 services
yarn dev
```

This runs `turbo run dev --parallel`, which starts:
- `apps/web` → Next.js on `:3000`
- `apps/backend` → LangGraph on `:2024` + FastAPI on `:3003` (via `concurrently`)

### Option B: Individual services

```bash
yarn dev:web      # Next.js only (:3000)
yarn dev:backend  # LangGraph + FastAPI (:2024 + :3003)
yarn dev:graph    # LangGraph only (:2024)
yarn dev:api      # FastAPI only (:3003)
```

### Option C: Makefile

```bash
make install   # first-time setup (yarn + pip)
make dev       # run everything
make dev-web   # Next.js only
make dev-graph # LangGraph only
make dev-api   # FastAPI only
```

---

## Key URLs (Development)

| Service              | URL                        |
|----------------------|----------------------------|
| Frontend (Next.js)   | http://localhost:3000       |
| LangGraph API        | http://localhost:2024       |
| FastAPI Portfolio API | http://localhost:3003      |
| LangGraph Studio     | Opens in browser on `langgraph dev` |
| OpenSpec Dashboard   | `openspec view` (interactive CLI) |

---

## Common Commands

```bash
# Install all dependencies
yarn install

# Run full stack (Next.js + LangGraph + FastAPI)
yarn dev

# Run only frontend
yarn dev:web

# Run both backend services (LangGraph + FastAPI)
yarn dev:backend

# Run individual backend services
yarn dev:graph    # LangGraph agent only (:2024)
yarn dev:api      # FastAPI portfolio API only (:3003)

# Build everything
yarn build

# Lint everything
yarn lint

# Add a dependency to the web workspace
yarn workspace web add <package>

# OpenSpec commands
openspec list                    # List active changes
openspec show <change-name>     # View change details
openspec validate <change-name> # Validate spec formatting
openspec view                   # Interactive dashboard
openspec update                 # Refresh AI agent instructions
```

---

## Architecture Notes

### Frontend ↔ Backend Communication

In **development**, the frontend sends browser requests to the Next.js API proxy. The proxy sends `/auth/*`, `/portfolio/*`, `/products/*`, `/admin/*`, and `/chat/*` to FastAPI via `PORTFOLIO_API_URL` and sends non-FastAPI paths to LangGraph via `LANGGRAPH_API_URL`.

In **production**, the Next.js server runs with **PM2** as process manager, so the API proxy route (`/api/[...path]`) works natively and injects `LANGCHAIN_API_KEY` server-side for LangGraph requests. `PORTFOLIO_API_URL` must point at the backend FastAPI deployment serving `api.routes:app`.

### assistant-ui Runtime

The current SABBI chat UI uses a custom `useExternalStoreRuntime` from `@assistant-ui/react` and streams from FastAPI `POST /api/chat/threads/:threadId/messages/stream`. Earlier scaffolded code used `useLangGraphRuntime`; treat that as legacy reference, not the active runtime.

- **Streaming**: Real-time token-by-token response rendering via FastAPI SSE
- **Thread management**: Active thread ID stored on the authenticated user record
- **Tool call display**: Converted from persisted LangChain messages into assistant-ui parts
- **Thinking/progress UI**: Driven by custom SSE `progress` and `reasoning` events

### LangGraph Dev Server

The `langgraph dev` command runs a lightweight, in-memory API server with hot-reloading. State is persisted to a local directory but is **not production-grade** — production uses Gunicorn + Uvicorn workers behind an ALB on EC2, with a PostgreSQL-backed checkpoint store.

### Dual Backend: LangGraph + FastAPI

The Python backend runs **two development services** that share the same PostgreSQL `products` table via `db.repository.ProductRepository`:

- **LangGraph dev server** (`:2024`) — local graph server for development and traces.
- **FastAPI** (`:3003` dev / `PORTFOLIO_API_URL` in prod, `src/api/routes.py`) — auth, portfolio CRUD/export, admin APIs, and the current chat SSE endpoints. It compiles the graph with a Postgres checkpointer/store when `POSTGRES_URI` is set.

The Next.js API proxy (`apps/web/app/api/[...path]/route.ts`) splits incoming requests by path prefix: `/api/auth/*`, `/api/portfolio/*`, `/api/products/*`, `/api/admin/*`, `/api/chat/*` → FastAPI (`PORTFOLIO_API_URL`); everything else → LangGraph (`LANGGRAPH_API_URL`). The frontend refetches the portfolio after each chat stream completes and after manual CRUD operations (`apps/web/lib/usePortfolio.ts`).

---

## Development Conventions

### Spec-Driven Changes (OpenSpec)

Every non-trivial feature or modification follows the OpenSpec workflow:

1. **Propose** — `/opsx:propose <feature-name>` creates the change artifacts
2. **Review** — Read `proposal.md` and `specs/` to validate scope and requirements
3. **Implement** — `/opsx:apply` or manually work through `tasks.md`
4. **Verify** — Ensure all scenarios in delta specs pass
5. **Archive** — `/opsx:archive` merges specs into the source of truth

Always check `openspec/specs/` before making changes to understand existing behavior. Update `design.md` and `tasks.md` as you learn — the workflow is iterative, not waterfall.

### Adding New Graph Nodes

1. Define the node function in `apps/backend/src/agent/nodes.py`
2. Add the node to the graph in `apps/backend/src/agent/graph.py`
3. The dev server hot-reloads automatically

### Adding New Tools

1. Define tools in `apps/backend/src/agent/tools.py` using `@tool` decorator
2. Bind them to the LLM: `llm_with_tools = llm.bind_tools([your_tool])`
3. Add conditional routing for tool calls in the graph

### Adding assistant-ui Components

```bash
cd apps/web
npx assistant-ui@latest add thread thread-list
```

This copies styled, customizable components into `components/assistant-ui/`.

---

## CI/CD — GitHub Actions

### AWS Prerequisites

Before the workflows can run, set up these AWS resources:

**ECR (both services):**

1. Create two ECR private repositories: one for frontend (e.g. `boilerplate-web`), one for backend (e.g. `boilerplate-backend`)

**EC2 (both services):**

1. Launch EC2 instances (Amazon Linux 2023 or Ubuntu 22.04+ recommended)
2. Install Docker and configure the instance to pull from ECR (`aws ecr get-login-password`)
3. Open security group ports: `3000` (frontend), `8000` (backend), `22` (SSH for deploys)
4. (Recommended) Place an ALB in front of the EC2 instances for HTTPS termination and health checks
5. Generate an SSH key pair — store the private key as a GitHub secret

**IAM:**

Create an IAM user (or OIDC role) with permissions for ECR push/pull. The EC2 instance profile also needs `ecr:GetAuthorizationToken` and `ecr:BatchGetImage` to pull images. Store deploy credentials as GitHub repository secrets.

### Required GitHub Secrets

| Secret | Used by | Description |
|--------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | All deploy workflows | IAM access key (ECR push) |
| `AWS_SECRET_ACCESS_KEY` | All deploy workflows | IAM secret key |
| `AWS_REGION` | All deploy workflows | e.g. `us-east-1` |
| `ECR_REGISTRY` | All deploy workflows | ECR registry URL (e.g. `123456789.dkr.ecr.us-east-1.amazonaws.com`) |
| `ECR_REPO_FRONTEND` | Frontend deploy | ECR repository name for the frontend |
| `ECR_REPO_BACKEND` | Backend deploy | ECR repository name for the backend |
| `EC2_HOST_FRONTEND` | Frontend deploy | Public IP or hostname of the frontend EC2 instance |
| `EC2_HOST_BACKEND` | Backend deploy | Public IP or hostname of the backend EC2 instance |
| `EC2_SSH_USER` | All deploy workflows | SSH user on EC2 (e.g. `ec2-user` or `ubuntu`) |
| `EC2_SSH_KEY` | All deploy workflows | Private SSH key (PEM format) for EC2 access |
| `LANGGRAPH_API_URL` | Frontend deploy | LangGraph backend URL for the proxy route (e.g. `http://<backend-ec2>:8000`) |
| `LANGCHAIN_API_KEY` | Frontend deploy | LangSmith API key injected at runtime |
| `PORTFOLIO_API_URL` | Both deploy workflows | FastAPI portfolio API URL used by the Next.js proxy (`/api/portfolio/*`, `/api/products/*`) |
| `ANTHROPIC_API_KEY` | Backend deploy | Claude API key injected at runtime (agent is Anthropic-only) |
| `DATABASE_URL` | Backend deploy | Postgres connection string for the portfolio `products` table (`db.connection.get_pool`) |
| `LANGSMITH_API_KEY` | Backend deploy | LangSmith key injected at runtime |

### Frontend Dockerfile (`apps/web/Dockerfile`)

Next.js runs as a full server (SSR, API routes, middleware all work) managed by PM2 for zero-downtime restarts and cluster mode:

```dockerfile
FROM node:20-alpine AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile --production=false

# --- Builder ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build

# --- Runner ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install -g pm2

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY ecosystem.config.js .

USER nextjs

EXPOSE 3000

CMD ["pm2-runtime", "ecosystem.config.js"]
```

### PM2 Configuration (`apps/web/ecosystem.config.js`)

```javascript
module.exports = {
  apps: [
    {
      name: "boilerplate-web",
      script: "server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        PORT: 3000,
        NODE_ENV: "production",
      },
    },
  ],
};
```

### Next.js Standalone Output (`apps/web/next.config.ts`)

For Docker deployments, use the `standalone` output mode which bundles a minimal Node.js server:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

**Note:** Unlike static export, `standalone` keeps all Next.js features working — API routes, SSR, middleware, and the `/api/[...path]` proxy to the LangGraph backend all function normally.

### Backend Dockerfile (`apps/backend/Dockerfile`)

**Recommendation:** Use **Gunicorn with Uvicorn workers** for the backend. Gunicorn manages worker processes (auto-restart on crash, graceful reloads) while Uvicorn handles the async event loop that LangGraph's streaming API requires. This is the standard production pattern for Python async web servers.

```dockerfile
FROM python:3.11-slim AS base

WORKDIR /app

# --- Application + dependencies ---
COPY . .
RUN pip install --no-cache-dir gunicorn \
    && pip install --no-cache-dir -e .

RUN useradd --system --no-create-home appuser
USER appuser

EXPOSE 8000

# Gunicorn with Uvicorn workers:
#   -w 4              → 4 worker processes (adjust to CPU count)
#   -k uvicorn.workers.UvicornWorker → async worker class
#   --timeout 120     → long timeout for streaming LLM responses
#   --graceful-timeout 30 → time for in-flight requests to finish on reload
CMD ["gunicorn", \
     "api.routes:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-"]
```

**Why Gunicorn + Uvicorn over alternatives:**

| Option | Pros | Cons |
|--------|------|------|
| **Gunicorn + Uvicorn** (chosen) | Multi-process, auto-restart, graceful reload, battle-tested | Slightly more configuration |
| `uvicorn` standalone | Simplest setup | Single process, no auto-restart on crash |
| `langgraph serve` | Zero config | Single process, limited tuning, meant for staging |
| Hypercorn | HTTP/2 support | Smaller ecosystem, fewer production deployments |

### Workflow 1 — CI (`.github/workflows/ci.yml`)

Runs on every pull request and push to `main`. Lints and tests both frontend and backend.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  frontend:
    name: Frontend — Lint & Build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/web
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: |
          cd ../..
          yarn install --frozen-lockfile

      - name: Lint
        run: yarn lint

      - name: Build
        run: yarn build

  backend:
    name: Backend — Lint & Test
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/backend
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: pip install -e ".[dev]"

      - name: Lint
        run: ruff check src/

      - name: Test
        run: pytest -q || echo "No tests found — skipping"
```

### Workflow 2 — Deploy Frontend (`.github/workflows/deploy-frontend.yml`)

Builds the Docker image with PM2, pushes to ECR, SSHs into the EC2 instance and pulls the new image.

```yaml
name: Deploy Frontend

on:
  push:
    branches: [main]
    paths:
      - "apps/web/**"

jobs:
  deploy:
    name: Build & Deploy to EC2
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push frontend image
        env:
          ECR_REGISTRY: ${{ secrets.ECR_REGISTRY }}
          ECR_REPOSITORY: ${{ secrets.ECR_REPO_FRONTEND }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:latest \
            apps/web
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST_FRONTEND }}
          username: ${{ secrets.EC2_SSH_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            aws ecr get-login-password --region ${{ secrets.AWS_REGION }} \
              | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}

            docker pull ${{ secrets.ECR_REGISTRY }}/${{ secrets.ECR_REPO_FRONTEND }}:latest

            docker stop boba-fett-web || true
            docker rm boba-fett-web || true

            docker run -d \
              --name boba-fett-web \
              --restart unless-stopped \
              -p 3000:3000 \
              -e LANGGRAPH_API_URL=${{ secrets.LANGGRAPH_API_URL }} \
              -e LANGCHAIN_API_KEY=${{ secrets.LANGCHAIN_API_KEY }} \
              -e PORTFOLIO_API_URL=${{ secrets.PORTFOLIO_API_URL }} \
              -e NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent \
              ${{ secrets.ECR_REGISTRY }}/${{ secrets.ECR_REPO_FRONTEND }}:latest
```

### Workflow 3 — Deploy Backend (`.github/workflows/deploy-backend.yml`)

Builds the Docker image with Gunicorn + Uvicorn, pushes to ECR, SSHs into the EC2 instance and pulls the new image.

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths:
      - "apps/backend/**"

jobs:
  deploy:
    name: Build & Deploy to EC2
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push backend image
        env:
          ECR_REGISTRY: ${{ secrets.ECR_REGISTRY }}
          ECR_REPOSITORY: ${{ secrets.ECR_REPO_BACKEND }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
            -t $ECR_REGISTRY/$ECR_REPOSITORY:latest \
            apps/backend
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest

      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST_BACKEND }}
          username: ${{ secrets.EC2_SSH_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            aws ecr get-login-password --region ${{ secrets.AWS_REGION }} \
              | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}

            docker pull ${{ secrets.ECR_REGISTRY }}/${{ secrets.ECR_REPO_BACKEND }}:latest

            docker stop boba-fett-backend || true
            docker rm boba-fett-backend || true

            docker run -d \
              --name boba-fett-backend \
              --restart unless-stopped \
              -p 8000:8000 \
              -e ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }} \
              -e LANGSMITH_API_KEY=${{ secrets.LANGSMITH_API_KEY }} \
              -e LANGSMITH_TRACING=true \
              -e LANGSMITH_PROJECT=boba-fett-v3 \
              -e DATABASE_URL=${{ secrets.DATABASE_URL }} \
              -e POSTGRES_URI=${{ secrets.POSTGRES_URI }} \
              -e JWT_SECRET=${{ secrets.JWT_SECRET }} \
              -e JWT_REFRESH_SECRET=${{ secrets.JWT_REFRESH_SECRET }} \
              -e ADMIN_EMAIL=${{ secrets.ADMIN_EMAIL }} \
              -e ADMIN_PASSWORD=${{ secrets.ADMIN_PASSWORD }} \
              -e TAVILY_API_KEY=${{ secrets.TAVILY_API_KEY }} \
              ${{ secrets.ECR_REGISTRY }}/${{ secrets.ECR_REPO_BACKEND }}:latest
```

See `.github/workflows/deploy-backend.yml` for the full, up-to-date command.

### EC2 Instance Setup (one-time)

Run these commands on each EC2 instance before the first deploy:

```bash
# Amazon Linux 2023
sudo yum install -y docker
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker ec2-user

# Install AWS CLI (if not pre-installed)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Configure ECR login (instance profile handles auth)
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <your-ecr-registry>
```

### How It Fits Together

```
  PR opened / push to main
        │
        ▼
  ┌─────────────┐
  │   ci.yml     │  ← Lint + build frontend, lint + test backend
  └─────────────┘
        │ (main only, path-filtered)
        ▼
  ┌─────────────────────┐     ┌──────────────────────┐
  │ deploy-frontend.yml │     │  deploy-backend.yml  │
  │                     │     │                      │
  │ docker build (PM2)  │     │ docker build         │
  │ push to ECR         │     │ (Gunicorn+Uvicorn)   │
  │ SSH → EC2 pull+run  │     │ push to ECR          │
  │ :3000               │     │ SSH → EC2 pull+run   │
  └─────────────────────┘     │ :8000                │
                              └──────────────────────┘
```

Both deploy workflows are **path-filtered** — changes in `apps/web/` trigger only the frontend deploy, and changes in `apps/backend/` trigger only the backend deploy. If a single commit touches both, both workflows run in parallel.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `langgraph dev` fails to start | Ensure `langgraph-cli[inmem]` is installed and `LANGSMITH_API_KEY` is set |
| Frontend can't reach backend | Verify `PORTFOLIO_API_URL=http://localhost:3003` and `LANGGRAPH_API_URL=http://localhost:2024` in `apps/web/.env.local` |
| CORS errors in browser | The LangGraph dev server allows localhost by default; ensure the port matches |
| `turbo` not found | Run `yarn install` at the root to install the turbo binary |
| Duplicate `@assistant-ui/core` | Run `npx assistant-ui@latest doctor` to diagnose version conflicts |
| Python import errors | Make sure you ran `pip install -e .` from `apps/backend/` |
| OpenSpec commands not recognized | Run `openspec update` to refresh agent instruction files |
| ECR login fails in GitHub Actions | Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets are set and the IAM user has `ecr:GetAuthorizationToken` permission |
| SSH deploy step fails | Ensure `EC2_SSH_KEY` secret contains the full PEM key, `EC2_HOST_*` is reachable, and port 22 is open in the security group |
| Container starts but app is unreachable | Check `docker logs boba-fett-web` (or `boba-fett-backend`); verify ports 3000/8000 are open in the EC2 security group |
| PM2 shows 0 instances online | Ensure `output: "standalone"` is set in `next.config.ts` so `server.js` is generated in `.next/standalone` |
| Gunicorn workers keep dying | Increase `--timeout` if LLM responses are slow; check EC2 instance memory (each Uvicorn worker uses ~200-400 MB) |
| Docker pull fails on EC2 | The instance profile needs `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`; re-run `aws ecr get-login-password` |
| `asyncpg.exceptions.InvalidCatalogNameError` / connection refused | Postgres isn't running or `DATABASE_URL` is wrong; start Postgres (`docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`) and verify `DATABASE_URL` in `apps/backend/.env` |
| Products don't appear after Postgres restart | Schema is auto-applied on first `get_pool()` call (`db/connection.py` runs `schema.sql`), but the `products` table itself is unaffected by restarts — check `docker ps`/`psql` if data looks missing, not the schema step |
| Portfolio panel stuck loading / `fetch` to `/api/portfolio/*` fails | The FastAPI service isn't running — start it with `yarn dev:api` (`:3003`) or `yarn dev:backend` |
| Proxy returns 502/404 for `/api/portfolio/*` or `/api/chat/*` | Check `PORTFOLIO_API_URL` in `apps/web/.env.local` (dev) or the deploy env var (prod). These paths require the backend FastAPI container serving `api.routes:app`. |
| Agent doesn't call `add_product` after a document upload | Verify the uploaded file's content block `type` is one of `image_url`, `image`, `document`, `file` (`agent/nodes.py` → `_ATTACHMENT_CONTENT_TYPES`) so `has_file_attachment` routes to `process_document` |

---

## Tech Stack Summary

| Layer          | Technology                                       |
|----------------|--------------------------------------------------|
| Frontend       | Next.js 15, React 19, Tailwind CSS, assistant-ui |
| Runtime        | `@assistant-ui/react` custom external-store runtime |
| Agent Backend  | LangGraph (Python), LangChain, Anthropic Claude (`claude-sonnet-4-20250514`) |
| REST API       | FastAPI (`src/api/routes.py`) — direct portfolio CRUD, no LLM call |
| Database       | PostgreSQL (`asyncpg`) — portfolio `products` table, shared by agent tools and REST API |
| Excel Export   | openpyxl (`src/db/excel.py`) — server-side `.xlsx` generation |
| Dev Server     | `langgraph dev` (in-memory, hot-reload) + `uvicorn --reload` (FastAPI) |
| Monorepo       | Yarn workspaces + Turborepo                      |
| Orchestration  | concurrently / Makefile                          |
| CI/CD          | GitHub Actions (ci, deploy-frontend, deploy-backend) |
| Frontend Prod  | Docker + PM2 (cluster mode) on EC2               |
| Backend Prod   | Docker + Gunicorn + Uvicorn workers on EC2       |
| Container Reg. | AWS ECR (private repositories)                   |
| Spec Framework | OpenSpec (SDD) — https://github.com/Fission-AI/OpenSpec |****
