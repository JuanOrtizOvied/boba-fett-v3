# syntax=docker/dockerfile:1
#
# Production image for the SABBI FastAPI backend.
# Build context is apps/backend (single Python package, no workspace deps):
#
#   docker build -f apps/backend/Dockerfile -t backend apps/backend
#
FROM python:3.11-slim AS base

WORKDIR /app

# --- Application + dependencies ---
# `pip install -e .` needs `src/` present because the package uses a src layout.
# Do not fall back to requirements.txt here: it is intentionally minimal for
# older bootstrap flows and does not include current auth/checkpointer/search
# runtime dependencies from pyproject.toml.
COPY . .
RUN pip install --no-cache-dir gunicorn \
    && pip install --no-cache-dir -e .

RUN useradd --system --no-create-home appuser
USER appuser

EXPOSE 8000

# Gunicorn with Uvicorn workers:
#   -w 4              -> 4 worker processes (adjust to CPU count)
#   -k uvicorn.workers.UvicornWorker -> async worker class
#   --timeout 120     -> long timeout for streaming LLM responses
#   --graceful-timeout 30 -> time for in-flight requests to finish on reload
#
CMD ["gunicorn", \
     "api.routes:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-"]
