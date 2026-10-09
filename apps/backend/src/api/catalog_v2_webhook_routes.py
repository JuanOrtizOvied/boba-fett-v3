"""Microsoft Graph webhook endpoints of the v2 catalog sync
(`openspec/changes/catalog-v2-sharepoint-sync`, design.md ADR-7).

Graph cannot log in, so there is no admin or user dependency here. A request is
trusted only when its `clientState` matches the one stored for its subscription
in `webhook_subscriptions_v2` (constant-time comparison). The routes answer fast,
as Graph expects, and do the real work in a background task. Nothing in a log
line or a response ever contains a `clientState`, a token or the client secret.

These are v2's own endpoints, next to the ones of the current sync: a change in
the other workbook notifies the other subscription, and a notification that
reaches this one finds the same file hash and writes nothing.
"""

from __future__ import annotations

import hmac
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Request, Response
from fastapi.responses import PlainTextResponse

from catalog_v2.config import Settings
from catalog_v2.diff import DELETE, INSERT, LINK, PRODUCT, SERIES, UPDATE
from catalog_v2.graph import GraphClient
from catalog_v2.lock import LockTimeoutError
from catalog_v2.repository import CatalogV2Repository
from catalog_v2.service import SyncDisabledError, run_sync_from_sharepoint
from catalog_v2.subscriptions import (
    list_subscriptions,
    recreate_subscription,
    renew_subscription,
)

logger = logging.getLogger("catalog_v2.webhook")

router = APIRouter(prefix="/webhooks/graph-v2", tags=["webhooks-v2"])


async def _read_items(request: Request) -> list[dict[str, Any]] | None:
    """The notification items in the body, or `None` if the body is not a
    non-empty `{"value": [...]}`."""
    try:
        body = await request.json()
    except ValueError:
        return None
    items = body.get("value") if isinstance(body, dict) else None
    if not isinstance(items, list) or not items:
        return None
    if not all(isinstance(item, dict) for item in items):
        return None
    return items


async def _is_authentic(repo: CatalogV2Repository, items: list[dict[str, Any]]) -> bool:
    """Every item must carry the `clientState` stored for its subscription. An
    item that names an unknown subscription, or none matching, fails."""
    stored = {s.subscription_id: s.client_state for s in await list_subscriptions(repo.pool)}
    if not stored:
        return False
    for item in items:
        received = item.get("clientState")
        if not isinstance(received, str):
            return False
        subscription_id = item.get("subscriptionId")
        if subscription_id is None:
            candidates = list(stored.values())
        elif subscription_id in stored:
            candidates = [stored[subscription_id]]
        else:
            return False
        received_bytes = received.encode("utf-8")
        # Check every candidate so the time does not depend on which matched.
        matches = [
            hmac.compare_digest(received_bytes, expected.encode("utf-8")) for expected in candidates
        ]
        if not any(matches):
            return False
    return True


async def _sync_in_background(repo: CatalogV2Repository) -> None:
    try:
        report = await run_sync_from_sharepoint(repo.pool)
    except SyncDisabledError:
        logger.info("Catalog v2 sync notification ignored: sync is disabled")
    except LockTimeoutError:
        logger.warning("Catalog v2 sync notification dropped: another sync holds the lock")
    except Exception as exc:  # a background task must never raise
        logger.error("Catalog v2 sync failed: %s: %s", type(exc).__name__, exc)
    else:
        if report.skipped or report.changeset is None:
            logger.info("Catalog v2 sync skipped: content unchanged")
        else:
            changes = report.changeset
            logger.info(
                "Catalog v2 sync applied: %s",
                ", ".join(
                    f"{label} +{len(changes.of(level, INSERT))}"
                    f" ~{len(changes.of(level, UPDATE))} -{len(changes.of(level, DELETE))}"
                    for level, label in (
                        (PRODUCT, "products"),
                        (SERIES, "series"),
                        (LINK, "links"),
                    )
                ),
            )


@router.post("/notifications")
async def graph_notifications(
    request: Request, background_tasks: BackgroundTasks, validationToken: str | None = None
) -> Response:
    """Change notifications: answers the validation handshake, otherwise checks
    every `clientState`, replies `202` at once and syncs in the background (one
    run per request, however many items it carries)."""
    if validationToken is not None:
        return PlainTextResponse(validationToken)

    items = await _read_items(request)
    if items is None:
        return Response(status_code=400)

    repo: CatalogV2Repository = request.app.state.catalog_v2_repo
    if not await _is_authentic(repo, items):
        return Response(status_code=401)

    background_tasks.add_task(_sync_in_background, repo)
    return Response(status_code=202)


async def _handle_lifecycle_event(repo: CatalogV2Repository, item: dict[str, Any]) -> None:
    event = item.get("lifecycleEvent")
    subscription_id = item.get("subscriptionId")
    settings = Settings.from_env()
    if not settings.sync_enabled:
        logger.info("Lifecycle event ignored: catalog v2 sync is disabled")
        return

    try:
        if event == "reauthorizationRequired" and isinstance(subscription_id, str):
            async with GraphClient(settings) as client:
                await renew_subscription(repo.pool, client, subscription_id)
            logger.info("Catalog v2 Graph subscription renewed")
        elif event == "subscriptionRemoved" and isinstance(subscription_id, str):
            async with GraphClient(settings) as client:
                await recreate_subscription(repo.pool, client, settings, subscription_id)
            logger.info("Catalog v2 Graph subscription recreated")
        elif event == "missed":
            # Notifications were lost: catch up from the workbook itself.
            await _sync_in_background(repo)
        else:
            logger.info("Lifecycle event ignored: %s", event)
    except Exception as exc:  # a background task must never raise
        logger.error("Lifecycle event %s failed: %s: %s", event, type(exc).__name__, exc)


async def _handle_lifecycle_events(repo: CatalogV2Repository, items: list[dict[str, Any]]) -> None:
    for item in items:
        await _handle_lifecycle_event(repo, item)


@router.post("/lifecycle")
async def graph_lifecycle(
    request: Request, background_tasks: BackgroundTasks, validationToken: str | None = None
) -> Response:
    """Lifecycle events: renews a subscription Graph asks to reauthorize, recreates
    one it removed and re-syncs after missed notifications. Same handshake and
    `clientState` check as the notification endpoint; once authenticated it always
    answers `200` and works in the background."""
    if validationToken is not None:
        return PlainTextResponse(validationToken)

    items = await _read_items(request)
    if items is None:
        return Response(status_code=400)

    repo: CatalogV2Repository = request.app.state.catalog_v2_repo
    if not await _is_authentic(repo, items):
        return Response(status_code=401)

    background_tasks.add_task(_handle_lifecycle_events, repo, items)
    return Response(status_code=200)
