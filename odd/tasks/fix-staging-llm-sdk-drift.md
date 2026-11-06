# Feature: Fix staging LLM SDK drift (pin Anthropic SDK + reproducible build + logging)

- **Feature ID:** `fix-staging-llm-sdk-drift`
- **File locator:** `odd/tasks/fix-staging-llm-sdk-drift.md`
- **Engram mirror topic:** `odd/fix-staging-llm-sdk-drift/tasks`
- **Branch:** `feat/fix-staging-llm-sdk-drift` off `main`.
- **TDD mode:** strict. Runner: `apps/backend/.venv/bin/python -m pytest -q` (or the active backend venv). asyncio_mode=auto.
- **Route declaration:** INLINE — config-heavy, fully understood after live reproduction; parent holds full context.

## Problem (confirmed with live reproduction)

Ficha "Buscar con Claude" (web_search/web_fetch) returns empty in STAGING but works
in LOCAL, with an identical `ANTHROPIC_API_KEY`.

Root cause (proven, not guessed): the backend Docker image installs via
`pip install --no-cache-dir -e .`, which reads the FLOATING `langchain-anthropic>=0.3`
in `pyproject.toml` and IGNORES `uv.lock`. The staging image resolved the latest
PyPI versions at build time: `langchain-anthropic==1.7.10` + `anthropic==2.6.0`.
Under that stack every `ChatAnthropic(..., temperature=0)` call routes through
`beta.messages` and the endpoint rejects `temperature` -> HTTP 400
`invalid_request_error: "temperature: Extra inputs are not permitted"`. The call
raises; with NO logging configured in the backend, the exception never reached
`docker logs`, so it looked like "returns empty".

Live repro matrix (isolated uv venvs, real API, model claude-haiku-4-5):
- STAGING stack (anthropic 2.6.0 / lc-anthropic 1.7.10): any `temperature` call -> 400.
  Removing `temperature` -> OK (content_blocks parsing + 5 sources are fine).
- LOCAL stack (anthropic 0.122.0 / lc-anthropic 1.5.6): all variants OK.
- lc-anthropic 1.7.10 is the LATEST and declares `anthropic>=0.120.0` (open upper
  bound); no newer lc-anthropic fixes this. So Option B (upgrade to anthropic 2.x)
  would force dropping `temperature` everywhere (losing determinism) for no gain.

## Decision: Option A (user-confirmed)

Pin the Anthropic SDK pair to the known-good versions, make the build reproducible
so it can't silently drift into the broken major again, and add logging so future
staging issues are visible. No code behavior change; `temperature=0` determinism kept.

## Tasks

- [x] **T-1 — Pin the Anthropic SDK pair (caps-only) + regression guard.** DONE. INLINE.
  `pyproject.toml`: added explicit `anthropic>=0.116.0,<1.0` (direct dep) and
  capped `langchain-anthropic>=0.3,<1.6`. Caps-only (permissive lower bounds) so
  they exclude the broken major WITHOUT forcing transitive churn. Added
  `tests/test_sdk_versions.py` (2 asserts: `anthropic` major < 1, `langchain-anthropic`
  < 1.6). TDD: RED under staging venv (`AssertionError: GUARD CAUGHT anthropic 2.6.0`),
  GREEN on backend .venv (2 passed).
  DISCOVERY: `uv.lock` is **gitignored** (`.gitignore:33`) — not in the repo — so
  deploy's `pip install -e .` resolves the highest versions within the caps. Verified
  that exact deploy set in an isolated venv: anthropic 0.125.0 / langchain-anthropic
  1.5.6 / langchain-core 1.7.6; all 524 tests collect with no import errors and the
  52 LLM/search/guard tests pass. The gitignored lock makes T-2 a real fork (commit
  the lock vs accept caps-only). Commit: `<pending>`.
- [ ] **T-2 — Reproducible backend build (install from the lockfile).** INLINE.
  Change `apps/backend/Dockerfile` so dependencies install from the frozen
  `uv.lock` instead of floating `pip install -e .`, so the lock stops being
  decorative and the resolved versions are deterministic. Keep gunicorn entrypoint
  working. Checks: image build reasoning / `uv sync --frozen` resolves; no CMD
  regression.
- [ ] **T-3 — Backend logging configuration.** INLINE (TDD). Add a small idempotent
  `configure_logging()` that ensures the root logger emits to stdout at INFO, call
  it at app startup (`api/routes.py`), and add `--capture-output --log-level info`
  to the gunicorn CMD. So `agent.search` warnings/exceptions (commit 9d79e83) reach
  `docker logs`. TDD: RED -> GREEN unit test for the helper (attaches a handler,
  idempotent). Checks: `pytest -q` green.

## Acceptance criteria
- Backend resolves `anthropic` in the 0.x known-good range and `langchain-anthropic`
  1.5.x in a fresh build (no drift to the temperature-breaking major).
- `uv.lock` matches the pins; the Docker build installs those exact locked versions.
- `agent.search` warning/exception logs are emitted to container stdout.
- Backend test suite green; ruff clean; no behavior change to the search cascade.

## Evidence / scratch
- Repro scripts: scratchpad `repro_web.py`, `repro2.py` (variant matrix A-D).
- Memory: Engram obs #831 (confirmed root cause + repro matrix).

## Next step
Start T-1 (pins + lock + guard test).
