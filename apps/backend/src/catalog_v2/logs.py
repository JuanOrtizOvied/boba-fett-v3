"""Logging of the v2 sync (`openspec/changes/catalog-v2-sharepoint-sync`).

Two things keep the messages of the v2 sync from reaching the console, and this module
deals with both:

1. The migrations run at startup, and `migrations/env.py` calls
   `logging.config.fileConfig`, whose default is to DISABLE every logger that already
   exists. The loggers of the v2 modules are created on import, so they are switched off
   before the app is up and nothing they say, not even an error, is printed.
   `setup_v2_logging` switches them on again in every environment, so the warnings and
   errors of the sync (a failed sync, a failed subscription upkeep, a notification
   rejected for a wrong `clientState`) are recorded where the backend logs normally go.
2. The root logger only lets warnings and above through, so the informational messages
   (subscription upkeep, safety sync, notifications received and what each one changed)
   stay hidden. With `IS_DEVELOPMENT=true` they are printed in the console, for the
   `catalog_v2` loggers only, so the libraries (`httpx`, `msal`), whose messages carry
   URLs with the site id, stay silent. With the variable unset or `false` they stay
   hidden, which is what staging and production want.
"""

from __future__ import annotations

import logging
import os
import sys

LOGGER_NAME = "catalog_v2"
HANDLER_NAME = "catalog_v2_dev_console"


def enable_v2_loggers() -> None:
    """Undo the `disabled` flag that `fileConfig` leaves on the loggers of the v2 modules."""
    for name, logger in list(logging.root.manager.loggerDict.items()):
        if isinstance(logger, logging.Logger) and (
            name == LOGGER_NAME or name.startswith(f"{LOGGER_NAME}.")
        ):
            logger.disabled = False


def is_development() -> bool:
    """`IS_DEVELOPMENT=true` (any case, spaces ignored). Anything else is false."""
    return os.environ.get("IS_DEVELOPMENT", "false").strip().lower() == "true"


def configure_dev_logging() -> bool:
    """Show the INFO logs of `catalog_v2` in the console when `IS_DEVELOPMENT` is true.
    Safe to call more than once: the handler is added a single time. Returns whether
    the development logs are on."""
    if not is_development():
        return False
    enable_v2_loggers()
    logger = logging.getLogger(LOGGER_NAME)
    first_time = not any(handler.get_name() == HANDLER_NAME for handler in logger.handlers)
    if first_time:
        handler = logging.StreamHandler(sys.stdout)
        handler.set_name(HANDLER_NAME)
        handler.setFormatter(
            logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s", "%H:%M:%S")
        )
        logger.addHandler(handler)
        # A library may have put a handler on the root logger (the backend has one), and
        # each message would then be printed twice: here they stop at their own handler.
        logger.propagate = False
    logger.setLevel(logging.INFO)
    if first_time:
        logger.info("Catalog v2 development logs are on (IS_DEVELOPMENT=true)")
    return True


def setup_v2_logging() -> bool:
    """What the backend calls once the migrations have run: the loggers of the v2 sync are
    switched on in every environment, and the development logs are added on top when
    `IS_DEVELOPMENT=true`. Returns whether the development logs are on."""
    enable_v2_loggers()
    return configure_dev_logging()
