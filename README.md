# SABBI Portfolio Builder

SABBI is an AI-assisted investment portfolio builder. The app combines a Next.js + assistant-ui frontend, a FastAPI portfolio/auth/chat API, a LangGraph Claude agent, and PostgreSQL as the shared source of truth.

## Services

| Service | Path | Dev Port | Purpose |
|---------|------|----------|---------|
| Frontend | `apps/web` | `3000` | Authenticated portfolio UI, chat panel, admin panel, API proxy |
| FastAPI API | `apps/backend/src/api` | `3003` | Auth, portfolio CRUD/export, chat SSE, admin APIs |
| LangGraph dev server | `apps/backend/src/agent` | `2024` | Local LangGraph graph server for development and traces |
| PostgreSQL | external | `5432` | Users, refresh tokens, products, catalog, chat checkpoints |

In the current app, browser traffic goes through the Next.js proxy at `/api/[...path]`:

| Frontend path | Upstream |
|---------------|----------|
| `/api/auth/*`, `/api/portfolio/*`, `/api/products/*`, `/api/admin/*`, `/api/chat/*` | FastAPI (`PORTFOLIO_API_URL`) |
| Other paths, such as LangGraph SDK endpoints | LangGraph (`LANGGRAPH_API_URL`) |

The main chat UI uses FastAPI SSE endpoints under `/api/chat/*`. It does not use the browser LangGraph SDK runtime.

## Prerequisites

- Node.js >= 20
- Yarn 4.x via Corepack
- Python >= 3.11
- PostgreSQL >= 14 with `pgcrypto` and `pg_trgm`
- Anthropic API key
- Optional: Tavily API key for web-search enrichment

## Setup

### 1. Enable Yarn

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

### 4. Configure environment

Create `apps/web/.env.local`:

```env
LANGGRAPH_API_URL=http://localhost:2024
PORTFOLIO_API_URL=http://localhost:3003
NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID=agent
```

Create `apps/backend/.env`:

```env
ANTHROPIC_API_KEY=your_anthropic_key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sabbi
POSTGRES_URI=postgresql://postgres:postgres@localhost:5432/sabbi
JWT_SECRET=replace-with-a-long-random-secret
JWT_REFRESH_SECRET=replace-with-a-different-long-random-secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-secure-password

# Optional
TAVILY_API_KEY=
LANGSMITH_API_KEY=
LANGSMITH_TRACING=false
LANGSMITH_PROJECT=sabbi-portfolio-agent
```

`DATABASE_URL` is used by the portfolio/auth/catalog tables. `POSTGRES_URI` is used by LangGraph's Postgres checkpointer/store for the FastAPI chat endpoints. If `POSTGRES_URI` is missing, `/api/chat/*` returns `503`.

## Run Locally

From the repository root:

```bash
yarn dev
```

This starts:

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| LangGraph dev server | http://localhost:2024 |
| FastAPI API | http://localhost:3003 |

Run individual services when needed:

```bash
yarn dev:web
yarn dev:backend
yarn dev:graph
yarn dev:api
```

## Testing

Frontend:

```bash
yarn workspace web test
```

Backend unit tests:

```bash
cd apps/backend
pytest -q
```

Backend integration tests require a real Postgres database:

```bash
cd apps/backend
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sabbi_test pytest -q tests/integration
```

## Build And Lint

```bash
yarn build
yarn lint
```

## Production Notes

The frontend Docker image serves Next.js with PM2 and expects `PORTFOLIO_API_URL` to point at the backend FastAPI container.

The backend Dockerfile serves FastAPI `api.routes:app` with Gunicorn + Uvicorn workers on port `8000`. This container owns `/auth`, `/portfolio`, `/products`, `/admin`, and `/chat`.

Required production secrets include `DATABASE_URL`, `POSTGRES_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ANTHROPIC_API_KEY`. `POSTGRES_URI` is required for chat checkpoint persistence.

## Documentation

- `apps/web/DOCUMENTATION.md` - frontend architecture, routes, chat UI, dashboard, tests
- `apps/backend/DOCUMENTATION.md` - backend architecture, API routes, auth, database, search, deployment notes
- `openspec/specs/` - current behavior specifications
- `openspec/changes/` - active and archived SDD changes

## Project Structure

```text
boba-fett-v3/
├── apps/
│   ├── web/              # Next.js frontend
│   └── backend/          # FastAPI + LangGraph Python backend
├── packages/
│   └── shared/           # Shared workspace placeholder
├── openspec/             # SDD specifications and changes
├── turbo.json            # Turborepo config
├── Makefile              # Dev command shortcuts
└── package.json          # Yarn workspace root
```
