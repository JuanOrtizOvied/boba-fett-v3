"""The stored Microsoft Graph subscription: reading it, renewing it and
recreating it (`openspec/changes/catalog-sharepoint-sync`, Phase 7.4;
design.md ADR-10, ADR-11).

`webhook_subscriptions.drive_item_id` holds the subscription's `resource`
(for example `/drives/<drive id>/root`): that is what has to be sent again to
create a replacement. The row is updated in place on renew and recreate, so
`last_processed_hash` (the idempotency hash) always survives.

Creating the first subscription and the periodic renewal job build on these
functions in Phase 7.5.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import asyncpg

from catalog_sync.config import Settings
from catalog_sync.graph import GraphClient, GraphConfigError, GraphError

# Graph limits how long a SharePoint drive subscription can live (a little
# under 30 days), so renew well inside it. To confirm in the end-to-end test.
SUBSCRIPTION_LIFETIME = timedelta(days=28)


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
        raise GraphConfigError("GRAPH_NOTIFICATION_URL must end with /notifications")
    return f"{notification_url[: -len(suffix)]}/lifecycle"


async def list_subscriptions(pool: asyncpg.Pool) -> list[StoredSubscription]:
    rows = await pool.fetch(
        "SELECT subscription_id, client_state, expiration, drive_item_id "
        "FROM webhook_subscriptions ORDER BY id"
    )
    return [_from_row(r) for r in rows]


async def get_subscription(pool: asyncpg.Pool, subscription_id: str) -> StoredSubscription | None:
    row = await pool.fetchrow(
        "SELECT subscription_id, client_state, expiration, drive_item_id "
        "FROM webhook_subscriptions WHERE subscription_id = $1",
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
    """Push the expiration out and store it. Graph is called first, so a
    failed renewal leaves the stored expiration untouched."""
    new_expiration = (now or datetime.now(UTC)) + SUBSCRIPTION_LIFETIME
    await client.renew_subscription(subscription_id, new_expiration)
    await pool.execute(
        "UPDATE webhook_subscriptions SET expiration = $2, updated_at = now() "
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
    """Replace a subscription Graph removed or that expired: same resource,
    a new id and a new `clientState`, stored over the same row."""
    stored = await get_subscription(pool, subscription_id)
    if stored is None:
        raise LookupError("unknown subscription")
    if not settings.graph_notification_url:
        raise GraphConfigError("Missing SharePoint settings: GRAPH_NOTIFICATION_URL")

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
        "UPDATE webhook_subscriptions SET subscription_id = $1, client_state = $2, "
        "expiration = $3, updated_at = now() WHERE subscription_id = $4",
        new_id,
        client_state,
        new_expiration,
        subscription_id,
    )
    return StoredSubscription(new_id, client_state, new_expiration, stored.resource)
