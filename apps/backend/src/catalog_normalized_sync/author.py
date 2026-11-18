"""Who saved the workbook that a sync run read.

SharePoint keeps `lastModifiedBy` on the file: the user who saved its newest
version, with a display name and a corporate email. The email is what the history
stores (`normalized_sync_event.changed_by`); the screen shows only the part before
the `@`.

Looking the author up is an extra that must never get in the way of a sync, so
`fetch_last_editor` does not raise: when the author cannot be determined it
answers `UNKNOWN_AUTHOR` and logs a warning. The log never carries the person's
name or email.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from catalog_sync.graph import GraphError

logger = logging.getLogger(__name__)

# Stored when the author of a SharePoint run could not be determined. An email
# always has an `@`, so it can never be confused with this marker.
UNKNOWN_AUTHOR = "unknown"


class _FileReader(Protocol):
    async def get_file_by_path(self, site_id: str, path: str) -> dict[str, Any]: ...


def author_email(item: Any) -> str | None:
    """The corporate email, in lower case, of the user who last saved `item` (a
    Graph `driveItem` or file version), or None when there is none: no
    `lastModifiedBy`, an application instead of a person, a user without an email,
    or a value that is not an email."""
    actor = item.get("lastModifiedBy") if isinstance(item, dict) else None
    user = actor.get("user") if isinstance(actor, dict) else None
    email = user.get("email") if isinstance(user, dict) else None
    if not isinstance(email, str):
        return None
    email = email.strip().lower()
    return email if "@" in email else None


async def fetch_last_editor(graph: _FileReader, site_id: str, path: str) -> str:
    """The email of whoever saved the file at `path` last, or `UNKNOWN_AUTHOR`.
    Reads the file's metadata only (the same one request `get_file_by_path` makes).
    Never raises, except for a cancellation."""
    try:
        item = await graph.get_file_by_path(site_id, path)
    except GraphError as exc:
        logger.warning(
            "Could not read who saved the normalized workbook (Graph status=%s code=%s)",
            exc.status,
            exc.code,
        )
        return UNKNOWN_AUTHOR
    except Exception as exc:  # noqa: BLE001 - the author is an extra, never a reason to fail
        logger.warning("Could not read who saved the normalized workbook (%s)", type(exc).__name__)
        return UNKNOWN_AUTHOR

    email = author_email(item)
    if email is None:
        logger.warning(
            "The normalized workbook has no user email in lastModifiedBy; author is unknown"
        )
        return UNKNOWN_AUTHOR
    return email
