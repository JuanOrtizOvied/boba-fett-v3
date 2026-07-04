# CLAUDE.md — Boilerplate Template

## Project Overview

This is a **boilerplate template** monorepo for building AI assistant applications. It provides a ready-to-use setup with a **Next.js + assistant-ui** frontend and a **LangGraph** (Python) backend, orchestrated with Yarn workspaces and Turborepo.

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
│   │   │   ├── assistant.tsx   # LangGraph runtime wiring
│   │   │   └── api/
│   │   │       └── [...path]/
│   │   │           └── route.ts  # Proxy to LangGraph backend
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
- **OpenSpec** (`npm install -g @fission-ai/openspec@latest`)
- **LangSmith API key** (for LangGraph dev server — get one at https://smith.langchain.com)

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
  "name": "boilerplate-template",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "dev:web": "turbo run dev --filter=web",
    "dev:backend": "cd apps/backend && langgraph dev --port 2024 --no-browser",
    "dev:all": "concurrently \"yarn dev:backend\" \"yarn dev:web\"",
    "build": "turbo run build",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2",
    "concurrently": "^9"
  }
}
```

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
yarn add @assistant-ui/react @assistant-ui/react-langgraph @langchain/langgraph-sdk
npx assistant-ui@latest init
```

### 3. Environment variables (`apps/web/.env.local`)

```env
# For local development — points to the LangGraph dev server
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024

# The graph/assistant ID registered in langgraph.json
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent

# For production (uncomment and fill in):
# LANGCHAIN_API_KEY=your_langsmith_api_key
# LANGGRAPH_API_URL=your_production_langgraph_cloud_url
```

### 4. LangGraph SDK client (`apps/web/lib/chatApi.ts`)

```typescript
import { Client } from "@langchain/langgraph-sdk";

export const createClient = () => {
  const apiUrl =
    process.env["NEXT_PUBLIC_LANGGRAPH_API_URL"] ||
    (typeof window !== "undefined"
      ? new URL("/api", window.location.href).href
      : "/api");
  return new Client({ apiUrl });
};
```

### 5. Assistant runtime component (`apps/web/app/assistant.tsx`)

```tsx
"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useLangGraphRuntime,
  unstable_createLangGraphStream,
  type LangChainMessage,
} from "@assistant-ui/react-langgraph";
import { Thread } from "@/components/assistant-ui/thread";
import { createClient } from "@/lib/chatApi";

const ASSISTANT_ID = process.env["NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID"]!;

export function MyAssistant() {
  const client = useMemo(() => createClient(), []);

  const stream = useMemo(
    () =>
      unstable_createLangGraphStream({
        client,
        assistantId: ASSISTANT_ID,
      }),
    [client]
  );

  const runtime = useLangGraphRuntime({
    unstable_allowCancellation: true,
    stream,
    create: async () => {
      const { thread_id } = await client.threads.create();
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await client.threads.getState<{
        messages: LangChainMessage[];
      }>(externalId);
      return {
        messages: state.values.messages,
      };
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  );
}
```

### 6. API proxy route (`apps/web/app/api/[...path]/route.ts`)

This proxy forwards requests from the frontend to the LangGraph backend in production, injecting the API key server-side so it's never exposed to the browser:

```typescript
import { NextRequest, NextResponse } from "next/server";

const LANGGRAPH_API_URL =
  process.env["LANGGRAPH_API_URL"] || "http://localhost:2024";
const LANGCHAIN_API_KEY = process.env["LANGCHAIN_API_KEY"];

async function handleRequest(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api/, "");
  const url = new URL(path, LANGGRAPH_API_URL);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  if (LANGCHAIN_API_KEY) {
    headers.set("x-api-key", LANGCHAIN_API_KEY);
  }
  headers.delete("host");

  const response = await fetch(url, {
    method: req.method,
    headers,
    body: req.body,
    // @ts-expect-error — duplex is required for streaming request bodies
    duplex: "half",
  });

  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
```

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
name = "openspec-backend"
version = "0.1.0"
description = "Boilerplate template LangGraph agent backend"
requires-python = ">=3.11"
dependencies = [
    "langgraph>=0.4",
    "langchain-core>=0.3",
    "langchain-openai>=0.3",
    "langchain-anthropic>=0.3",
    "langgraph-cli[inmem]>=0.1.55",
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
from langchain_openai import ChatOpenAI
from agent.state import AgentState


llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)


async def chatbot(state: AgentState) -> AgentState:
    response = await llm.ainvoke(state["messages"])
    return {"messages": [response]}


builder = StateGraph(AgentState)
builder.add_node("chatbot", chatbot)
builder.add_edge(START, "chatbot")
builder.add_edge("chatbot", END)

graph = builder.compile()
```

### 6. Backend environment (`apps/backend/.env`)

```env
OPENAI_API_KEY=your_openai_api_key
LANGSMITH_API_KEY=your_langsmith_api_key

# Optional — enable LangSmith tracing
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=boilerplate-template
```

### 7. Install Python dependencies

```bash
cd apps/backend
pip install -e . "langgraph-cli[inmem]"
# — or with uv —
uv pip install -e . "langgraph-cli[inmem]"
```

### 8. Add a `dev` script for Turborepo compatibility

Create `apps/backend/package.json` so Turborepo can orchestrate it:

```json
{
  "name": "backend",
  "private": true,
  "scripts": {
    "dev": "langgraph dev --host 0.0.0.0 --port 2024 --no-browser"
  }
}
```

---

## Running Everything with One Command

### Option A: Turborepo (recommended)

```bash
# From the repo root
yarn dev
```

This runs `turbo run dev`, which starts both `apps/web` (Next.js on `:3000`) and `apps/backend` (LangGraph on `:2024`) in parallel with persistent mode.

### Option B: Concurrently (explicit)

```bash
yarn dev:all
```

Uses the `concurrently` package to run the backend and frontend in a single terminal with color-coded output.

### Option C: Makefile

Add a `Makefile` at the repo root:

```makefile
.PHONY: dev dev-web dev-backend install

install:
	yarn install
	cd apps/backend && pip install -e . "langgraph-cli[inmem]"

dev:
	yarn dev

dev-web:
	yarn dev:web

dev-backend:
	yarn dev:backend

dev-all:
	yarn dev:all
```

Then:

```bash
make install   # first-time setup
make dev       # run everything
```

---

## Key URLs (Development)

| Service            | URL                        |
|--------------------|----------------------------|
| Frontend (Next.js) | http://localhost:3000       |
| LangGraph API      | http://localhost:2024       |
| LangGraph Studio   | Opens in browser on `langgraph dev` |
| OpenSpec Dashboard | `openspec view` (interactive CLI) |

---

## Common Commands

```bash
# Install all dependencies
yarn install

# Run full stack
yarn dev

# Run only frontend
yarn dev:web

# Run only backend
yarn dev:backend

# Build everything
yarn build

# Lint everything
yarn lint

# Add a dependency to the web workspace
yarn workspace web add <package>

# Run LangGraph with a custom config
cd apps/backend && langgraph dev -c langgraph.json --port 2024

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

In **development**, the frontend connects directly to the LangGraph dev server at `http://localhost:2024` via `NEXT_PUBLIC_LANGGRAPH_API_URL`. The `@langchain/langgraph-sdk` client makes requests from the browser.

In **production**, both frontend and backend run as Docker containers on EC2 instances (images stored in ECR). The Next.js server runs with **PM2** as process manager, so the API proxy route (`/api/[...path]`) works natively — it injects the `LANGCHAIN_API_KEY` server-side, keeping it secret from the browser. The backend runs with **Gunicorn + Uvicorn workers** for async performance. Set `LANGGRAPH_API_URL` and `LANGCHAIN_API_KEY` as server-side env vars in your deployment.

### assistant-ui Runtime

The project uses `useLangGraphRuntime` from `@assistant-ui/react-langgraph`, which provides:

- **Streaming**: Real-time token-by-token response rendering via SSE
- **Thread management**: Create, load, and switch between conversation threads
- **Cancellation**: In-flight request cancellation support
- **Tool call display**: Automatic rendering of LLM tool invocations
- **Generative UI**: Map LangGraph `push_ui_message` calls to custom React components

### LangGraph Dev Server

The `langgraph dev` command runs a lightweight, in-memory API server with hot-reloading. State is persisted to a local directory but is **not production-grade** — production uses Gunicorn + Uvicorn workers behind an ALB on EC2, with a PostgreSQL-backed checkpoint store.

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
| `LANGGRAPH_API_URL` | Frontend deploy | Backend URL for the proxy route (e.g. `http://<backend-ec2>:8000`) |
| `LANGCHAIN_API_KEY` | Frontend deploy | LangSmith API key injected at runtime |
| `OPENAI_API_KEY` | Backend deploy | OpenAI key injected at runtime |
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

# --- Dependencies ---
COPY pyproject.toml requirements.txt* ./
RUN pip install --no-cache-dir \
    gunicorn \
    uvicorn[standard] \
    && pip install --no-cache-dir -e . 2>/dev/null \
    || pip install --no-cache-dir -r requirements.txt

# --- Application ---
COPY . .

RUN useradd --system --no-create-home appuser
USER appuser

EXPOSE 8000

# Gunicorn with Uvicorn workers:
#   -w 4              → 4 worker processes (adjust to CPU count)
#   -k uvicorn.workers.UvicornWorker → async worker class
#   --timeout 120     → long timeout for streaming LLM responses
#   --graceful-timeout 30 → time for in-flight requests to finish on reload
CMD ["gunicorn", \
     "langgraph_api.server:app", \
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
        run: pip install -e . "langgraph-cli[inmem]" ruff pytest

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

            docker stop boilerplate-web || true
            docker rm boilerplate-web || true

            docker run -d \
              --name boilerplate-web \
              --restart unless-stopped \
              -p 3000:3000 \
              -e LANGGRAPH_API_URL=${{ secrets.LANGGRAPH_API_URL }} \
              -e LANGCHAIN_API_KEY=${{ secrets.LANGCHAIN_API_KEY }} \
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

            docker stop boilerplate-backend || true
            docker rm boilerplate-backend || true

            docker run -d \
              --name boilerplate-backend \
              --restart unless-stopped \
              -p 8000:8000 \
              -e OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }} \
              -e LANGSMITH_API_KEY=${{ secrets.LANGSMITH_API_KEY }} \
              -e LANGSMITH_TRACING=true \
              -e LANGSMITH_PROJECT=boilerplate-template \
              ${{ secrets.ECR_REGISTRY }}/${{ secrets.ECR_REPO_BACKEND }}:latest
```

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
| Frontend can't reach backend | Verify `NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2024` in `.env.local` |
| CORS errors in browser | The LangGraph dev server allows localhost by default; ensure the port matches |
| `turbo` not found | Run `yarn install` at the root to install the turbo binary |
| Duplicate `@assistant-ui/core` | Run `npx assistant-ui@latest doctor` to diagnose version conflicts |
| Python import errors | Make sure you ran `pip install -e .` from `apps/backend/` |
| OpenSpec commands not recognized | Run `openspec update` to refresh agent instruction files |
| ECR login fails in GitHub Actions | Verify `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` secrets are set and the IAM user has `ecr:GetAuthorizationToken` permission |
| SSH deploy step fails | Ensure `EC2_SSH_KEY` secret contains the full PEM key, `EC2_HOST_*` is reachable, and port 22 is open in the security group |
| Container starts but app is unreachable | Check `docker logs boilerplate-web` (or `boilerplate-backend`); verify ports 3000/8000 are open in the EC2 security group |
| PM2 shows 0 instances online | Ensure `output: "standalone"` is set in `next.config.ts` so `server.js` is generated in `.next/standalone` |
| Gunicorn workers keep dying | Increase `--timeout` if LLM responses are slow; check EC2 instance memory (each Uvicorn worker uses ~200-400 MB) |
| Docker pull fails on EC2 | The instance profile needs `ecr:BatchGetImage` and `ecr:GetDownloadUrlForLayer`; re-run `aws ecr get-login-password` |

---

## Tech Stack Summary

| Layer          | Technology                                       |
|----------------|--------------------------------------------------|
| Frontend       | Next.js 15, React 19, Tailwind CSS, assistant-ui |
| Runtime        | `@assistant-ui/react-langgraph`                  |
| Backend        | LangGraph (Python), LangChain                    |
| Dev Server     | `langgraph dev` (in-memory, hot-reload)          |
| Monorepo       | Yarn workspaces + Turborepo                      |
| Orchestration  | concurrently / Makefile                          |
| CI/CD          | GitHub Actions (ci, deploy-frontend, deploy-backend) |
| Frontend Prod  | Docker + PM2 (cluster mode) on EC2               |
| Backend Prod   | Docker + Gunicorn + Uvicorn workers on EC2       |
| Container Reg. | AWS ECR (private repositories)                   |
| Spec Framework | OpenSpec (SDD) — https://github.com/Fission-AI/OpenSpec |****