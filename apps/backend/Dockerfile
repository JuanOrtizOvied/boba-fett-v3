# syntax=docker/dockerfile:1
#
# Production image for the LangGraph backend.
# Build context is apps/backend (single Python package, no workspace deps):
#
#   docker build -f apps/backend/Dockerfile -t backend apps/backend
#
FROM python:3.11-slim AS base

WORKDIR /app

# --- Dependencies ---
COPY pyproject.toml requirements.txt* ./
RUN pip install --no-cache-dir \
    gunicorn \
    uvicorn[standard] \
    langgraph-api \
    && pip install --no-cache-dir -e . 2>/dev/null \
    || pip install --no-cache-dir -r requirements.txt

# --- Application ---
COPY . .

RUN useradd --system --no-create-home appuser
USER appuser

EXPOSE 8000

# Gunicorn with Uvicorn workers:
#   -w 4              -> 4 worker processes (adjust to CPU count)
#   -k uvicorn.workers.UvicornWorker -> async worker class
#   --timeout 120     -> long timeout for streaming LLM responses
#   --graceful-timeout 30 -> time for in-flight requests to finish on reload
#
# NOTE: langgraph_api.server:app is provided by the `langgraph-api` package
# (installed above). The `langgraph-cli[inmem]` dev dependency used by
# `yarn dev:backend` is dev-only (in-memory store) and is NOT sufficient for
# production; this image installs `langgraph-api` explicitly for the ASGI app.
#
# VERIFIED (docker build + docker run, this bootstrap): the image builds and
# `docker run` starts, but langgraph_api.server:app fails fast at import time
# unless BOTH `DATABASE_URI` (Postgres, used as the checkpoint/thread store)
# and `REDIS_URI` (Redis, used as the task queue) are set — this is the full
# LangGraph Platform self-hosted runtime, not a lightweight wrapper around
# our custom src/agent/graph.py. Provisioning Postgres/Redis is real
# infrastructure and is OUT OF SCOPE for this bootstrap (see deploy-backend
# workflow secrets for the expected env vars); do not deploy this image
# without them.
CMD ["gunicorn", \
     "langgraph_api.server:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-"]
