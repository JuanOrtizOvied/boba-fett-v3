"""Backend logging bootstrap.

Gunicorn and uvicorn configure only their own named loggers and leave the root
logger without a stdout handler, so application loggers (e.g. ``agent.search``)
are silently dropped in the container. That is why a staging failure in the
ficha Claude web search looked like "returns empty": the exception was logged on
``agent.search`` but never reached ``docker logs``.

``configure_logging`` attaches a single stdout ``StreamHandler`` to the root
logger so application warnings/exceptions are visible. It is idempotent — safe to
call on every app startup — using a marker attribute instead of a module global,
so it still de-duplicates across re-imports and across worker processes.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import TextIO

_HANDLER_MARKER = "_sabbi_app_handler"
_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


def configure_logging(level: str | None = None, *, stream: TextIO | None = None) -> None:
    """Ensure the root logger emits application logs to stdout. Idempotent.

    ``level`` defaults to the ``LOG_LEVEL`` env var or ``INFO``. ``stream`` is
    injectable for tests; it defaults to ``sys.stdout`` so the container captures
    it.
    """
    root = logging.getLogger()
    resolved_level = (level or os.environ.get("LOG_LEVEL") or "INFO").upper()
    root.setLevel(resolved_level)

    if any(getattr(h, _HANDLER_MARKER, False) for h in root.handlers):
        return

    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    setattr(handler, _HANDLER_MARKER, True)
    root.addHandler(handler)
