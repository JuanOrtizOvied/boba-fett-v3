"""add_normalized_sync_event

Revision ID: c4e8a1b7d205
Revises: f8a9b0c1d2e3
Create Date: 2026-11-10 00:00:00.000000

Change history of the normalized catalog sync: one row per create, update,
delete or restore that a sync run applied. Append only and independent of the
catalog tables (no foreign key), so the history survives any delete. `trigger`
records what started the run; 'web' is allowed in advance for a future write
path. Separate from `catalog_product_history`, which belongs to the ficha
curation. DDL mirrors `src/db/schema.sql` verbatim and is idempotent (IF NOT
EXISTS), because a deployed backend runs `alembic upgrade head`, not
`schema.sql`.
"""

from alembic import op

revision = "c4e8a1b7d205"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS normalized_sync_event (
            id BIGSERIAL PRIMARY KEY,
            run_id UUID NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            trigger TEXT NOT NULL
                CHECK (trigger IN ('webhook', 'scheduler', 'lifecycle', 'manual', 'web')),
            action TEXT NOT NULL
                CHECK (action IN ('create', 'update', 'delete', 'restore')),
            level TEXT NOT NULL CHECK (level IN ('product', 'series', 'admin')),
            product_code TEXT NOT NULL,
            series TEXT,
            administrator TEXT,
            changes JSONB NOT NULL DEFAULT '[]'
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS normalized_sync_event_product_idx "
        "ON normalized_sync_event (product_code, occurred_at DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS normalized_sync_event_occurred_idx "
        "ON normalized_sync_event (occurred_at)"
    )


def downgrade() -> None:
    # Dropping the table drops its indexes too.
    op.execute("DROP TABLE IF EXISTS normalized_sync_event")
