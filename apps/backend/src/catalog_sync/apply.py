"""Applies a `catalog_sync.diff.ChangeSet` to Postgres inside one
transaction (`openspec/changes/catalog-sharepoint-sync` — design.md ADR-2,
ADR-8; spec scenario SYNC-29).

Not pure — this is the `catalog_sync` module that actually writes to the
database, through `CatalogRepository`'s dedicated sync methods
(`list_for_sync`/`sync_insert`/`sync_update`/`sync_soft_delete`, Phase 4.2).
Applying a `ChangeSet` acquires one connection, wraps the whole run in one
transaction, and lets any unexpected error propagate after the transaction
rolls back — "when in doubt, do not modify data". Adoptions are applied the
same way as updates: `AdoptChange.fields` already includes `codigo`
(`catalog_sync.diff`), so `sync_update` sets it along with every other
changed field in one statement.
"""

from __future__ import annotations

from catalog_sync.diff import ChangeSet
from db.catalog_repository import CatalogRepository


async def apply_changeset(repo: CatalogRepository, changeset: ChangeSet) -> None:
    """Apply every insert, update, adoption, and soft-delete in `changeset`
    inside a single transaction. If anything raises partway through, the
    transaction rolls back and the exception propagates — the caller
    (`catalog_sync.service`, Phase 4.4) decides how to log it, and must not
    treat the run as successful (in particular, never persist the new
    content hash) when this raises."""
    async with repo.pool.acquire() as conn:
        async with conn.transaction():
            for insert in changeset.inserts:
                await repo.sync_insert(insert.codigo, insert.fields, conn=conn)
            for update in changeset.updates:
                await repo.sync_update(update.catalog_id, update.fields, conn=conn)
            for adoption in changeset.adoptions:
                await repo.sync_update(adoption.catalog_id, adoption.fields, conn=conn)
            for soft_delete in changeset.soft_deletes:
                await repo.sync_soft_delete(soft_delete.catalog_id, conn=conn)
