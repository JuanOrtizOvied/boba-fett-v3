"""Tests for the backend logging bootstrap.

The backend configured no logging, so `agent.search` warnings/exceptions were
silently dropped under gunicorn/uvicorn and never reached `docker logs` — which
is why a staging failure looked like "returns empty". `configure_logging` must
attach a stdout handler to the root logger so application loggers are visible,
and be idempotent so repeated startups never duplicate handlers.
"""

import io
import logging

import pytest

from api import logging_config


@pytest.fixture
def restore_root_logger():
    root = logging.getLogger()
    saved_handlers = root.handlers[:]
    saved_level = root.level
    root.handlers[:] = []
    yield root
    root.handlers[:] = saved_handlers
    root.setLevel(saved_level)


def _marked(root: logging.Logger) -> list[logging.Handler]:
    return [h for h in root.handlers if getattr(h, "_sabbi_app_handler", False)]


def test_configure_logging_attaches_stdout_handler_at_info(restore_root_logger):
    root = restore_root_logger
    logging_config.configure_logging()
    assert len(_marked(root)) == 1
    assert root.level <= logging.INFO


def test_configure_logging_is_idempotent(restore_root_logger):
    root = restore_root_logger
    logging_config.configure_logging()
    logging_config.configure_logging()
    assert len(_marked(root)) == 1


def test_app_logger_output_reaches_the_stream(restore_root_logger):
    """A warning on `agent.search` must propagate to the configured stream."""
    buf = io.StringIO()
    logging_config.configure_logging(stream=buf)
    logging.getLogger("agent.search").warning("web research skipped: no key")
    assert "web research skipped: no key" in buf.getvalue()
