"""The stored Microsoft Graph subscription of the v2 sync: reading it, renewing
it, recreating it and keeping it alive
(`openspec/changes/catalog-v2-sharepoint-sync`, design.md ADR-7).

v2 has its own subscription on the same drive as the current sync, with its own
`notificationUrl` and `clientState`, stored in `webhook_subscriptions_v2`.
`drive_item_id` holds the subscription's `resource` (for example
`/drives/<drive id>/root`): that is what has to be sent again to create a
replacement. The row is updated in place on renew and recreate, so
`last_processed_hash` (the idempotency hash) always survives.

`ensure_subscription` is what the periodic job calls: it creates the first
subscription, renews one that is close to expiring and recreates one that
expired or that Graph no longer knows.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import asyncpg

from catalog_v2.config import Settings
from catalog_v2.graph import GraphClient, GraphConfigError, GraphError

# Graph limits how long a SharePoint drive subscription can live (a little under
# 30 days), so renew well inside it. To confirm in the end-to-end test.
SUBSCRIPTION_LIFETIME = timedelta(days=28)

# A subscription that expires within this window is renewed. It is much longer
# than the job interval, so several cycles can fail before it lapses.
RENEWAL_WINDOW = timedelta(days=3)


@dataclass(frozen=True)
class StoredSubscription:
    subscription_id: str
    client_state: str
    expiration: datetime
    resource: str


def _from_row(row: asyncpg.Record) -> StoredSubscription:
    return StoredSubscription(
        subscription_id=row["subscription_id"],
        client_state=row["client_state"],
        expiration=row["expiration"],
        resource=row["drive_item_id"],
    )


def lifecycle_url_for(notification_url: str) -> str:
    """The lifecycle endpoint lives next to the notification one."""
    suffix = "/notifications"
    if not notification_url.endswith(suffix):
        raise GraphConfigError("GRAPH_V2_NOTIFICATION_URL must end with /notifications")
    return f"{notification_url[: -len(suffix)]}/lifecycle"


async def list_subscriptions(pool: asyncpg.Pool) -> list[StoredSubscription]:
    rows = await pool.fetch(
        "SELECT subscription_id, client_state, expiration, drive_item_id "
        "FROM webhook_subscriptions_v2 ORDER BY id"
    )
    return [_from_row(r) for r in rows]


async def get_subscription(pool: asyncpg.Pool, subscription_id: str) -> StoredSubscription | None:
    row = await pool.fetchrow(
        "SELECT subscription_id, client_state, expiration, drive_item_id "
        "FROM webhook_subscriptions_v2 WHERE subscription_id = $1",
        subscription_id,
    )
    return _from_row(row) if row else None


async def renew_subscription(
    pool: asyncpg.Pool,
    client: GraphClient,
    subscription_id: str,
    *,
    now: datetime | None = None,
) -> datetime:
    """Push the expiration out and store it. Graph is called first, so a failed
    renewal leaves the stored expiration untouched."""
    new_expiration = (now or datetime.now(UTC)) + SUBSCRIPTION_LIFETIME
    await client.renew_subscription(subscription_id, new_expiration)
    await pool.execute(
        "UPDATE webhook_subscriptions_v2 SET expiration = $2, updated_at = now() "
        "WHERE subscription_id = $1",
        subscription_id,
        new_expiration,
    )
    return new_expiration


async def recreate_subscription(
    pool: asyncpg.Pool,
    client: GraphClient,
    settings: Settings,
    subscription_id: str,
    *,
    now: datetime | None = None,
) -> StoredSubscription:
    """Replace a subscription Graph removed or that expired: same resource, a new
    id and a new `clientState`, stored over the same row."""
    stored = await get_subscription(pool, subscription_id)
    if stored is None:
        raise LookupError("unknown subscription")
    if not settings.graph_notification_url:
        raise GraphConfigError("Missing SharePoint settings: GRAPH_V2_NOTIFICATION_URL")

    try:
        # Usually already gone; a leftover one must not keep notifying.
        await client.delete_subscription(subscription_id)
    except GraphError:
        pass

    new_expiration = (now or datetime.now(UTC)) + SUBSCRIPTION_LIFETIME
    client_state = secrets.token_urlsafe(32)
    created = await client.create_subscription(
        resource=stored.resource,
        notification_url=settings.graph_notification_url,
        lifecycle_url=lifecycle_url_for(settings.graph_notification_url),
        client_state=client_state,
        expiration=new_expiration,
    )
    new_id = created["id"]
    await pool.execute(
        "UPDATE webhook_subscriptions_v2 SET subscription_id = $1, client_state = $2, "
        "expiration = $3, updated_at = now() WHERE subscription_id = $4",
        new_id,
        client_state,
        new_expiration,
        subscription_id,
    )
    return StoredSubscription(new_id, client_state, new_expiration, stored.resource)


async def create_first_subscription(
    pool: asyncpg.Pool,
    client: GraphClient,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> StoredSubscription:
    """Subscribe to the drive that holds the workbook and store it. Graph only
    offers change notifications for the whole drive, not one file; the sync
    downloads the configured file and its hash check ignores the rest."""
    missing = [
        name
        for name, value in (
            ("SHAREPOINT_SITE_ID", settings.sharepoint_site_id),
            ("GRAPH_V2_NOTIFICATION_URL", settings.graph_notification_url),
        )
        if not value
    ]
    if missing:
        raise GraphConfigError(f"Missing SharePoint settings: {', '.join(missing)}")
    assert settings.sharepoint_site_id and settings.graph_notification_url

    drive = await client.get_default_drive(settings.sharepoint_site_id)
    resource = f"/drives/{drive['id']}/root"
    expiration = (now or datetime.now(UTC)) + SUBSCRIPTION_LIFETIME
    client_state = secrets.token_urlsafe(32)
    created = await client.create_subscription(
        resource=resource,
        notification_url=settings.graph_notification_url,
        lifecycle_url=lifecycle_url_for(settings.graph_notification_url),
        client_state=client_state,
        expiration=expiration,
    )
    await pool.execute(
        "INSERT INTO webhook_subscriptions_v2 "
        "(subscription_id, client_state, expiration, drive_item_id) VALUES ($1, $2, $3, $4)",
        created["id"],
        client_state,
        expiration,
        resource,
    )
    return StoredSubscription(created["id"], client_state, expiration, resource)


async def ensure_subscription(
    pool: asyncpg.Pool,
    client: GraphClient,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> list[str]:
    """Keep the subscription alive and return what was done, one entry per
    subscription: "created", "renewed", "recreated" or "none".

    No stored subscription: create one. Expired: recreate it (Graph has already
    dropped it, so it cannot be renewed). Expiring within `RENEWAL_WINDOW`: renew
    it, and recreate it if Graph answers 404 because it no longer knows it.
    Anything else is left alone.
    """
    now = now or datetime.now(UTC)
    stored = await list_subscriptions(pool)
    if not stored:
        await create_first_subscription(pool, client, settings, now=now)
        return ["created"]

    actions: list[str] = []
    for subscription in stored:
        if subscription.expiration <= now:
            await recreate_subscription(
                pool, client, settings, subscription.subscription_id, now=now
            )
            actions.append("recreated")
        elif subscription.expiration - now <= RENEWAL_WINDOW:
            try:
                await renew_subscription(pool, client, subscription.subscription_id, now=now)
                actions.append("renewed")
            except GraphError as exc:
                if exc.status != 404:
                    raise
                await recreate_subscription(
                    pool, client, settings, subscription.subscription_id, now=now
                )
                actions.append("recreated")
        else:
            actions.append("none")
    return actions
