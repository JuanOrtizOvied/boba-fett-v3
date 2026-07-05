# Boba Fett v3

AI assistant monorepo — Next.js + assistant-ui frontend with a configurable LangGraph (Python) backend.

## Prerequisites

- **Node.js** >= 20 (LTS recommended)
- **Python** >= 3.11
- **uv** (recommended) or **pip**

## Setup

### 1. Enable Corepack and activate Yarn 4

This project uses Yarn Berry (4.x) via Corepack. If you see a version mismatch error, run:

```bash
corepack enable
corepack prepare yarn@4.9.2 --activate
```

### 2. Install frontend dependencies

```bash
yarn install
```

### 3. Install backend dependencies

```bash
cd apps/backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### 4. Configure environment variables

Copy the example files and fill in your API keys:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/backend/.env.example apps/backend/.env
```

**Frontend** (`apps/web/.env.local`):

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_LANGGRAPH_API_URL` | LangGraph dev server URL | `http://localhost:2024` |
| `NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID` | Graph/assistant ID | `agent` |
| `LANGCHAIN_API_KEY` | LangSmith key (production proxy) | — |

**Backend** (`apps/backend/.env`):

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | `openai` or `anthropic` | `openai` |
| `LLM_MODEL` | Model name | `gpt-4o-mini` |
| `OPENAI_API_KEY` | OpenAI key (when provider is `openai`) | — |
| `ANTHROPIC_API_KEY` | Anthropic key (when provider is `anthropic`) | — |
| `LANGSMITH_API_KEY` | LangSmith key for tracing | — |

## Running the project

### Full stack (frontend + backend)

```bash
yarn dev
```

This starts both services via Turborepo:
- Frontend (Next.js) → http://localhost:3000
- Backend (LangGraph) → http://localhost:2024

### Frontend only

```bash
yarn dev:web
```

### Backend only

```bash
yarn dev:backend
```

> **Note:** The backend requires an activated Python virtualenv with dependencies installed. If `langgraph dev` can't find the package, make sure you ran `pip install -e .` from `apps/backend/`.

## Build

```bash
yarn build
```

## Lint

```bash
yarn lint
```

This runs Next.js lint on the frontend and ruff on the backend.

## Project structure

```
boba-fett-v3/
├── apps/
│   ├── web/              # Next.js + assistant-ui frontend
│   └── backend/          # LangGraph Python backend
├── packages/
│   └── shared/           # Shared packages (placeholder)
├── openspec/             # SDD specifications
├── turbo.json            # Turborepo config
├── Makefile              # Dev command shortcuts
└── package.json          # Workspace root
```
