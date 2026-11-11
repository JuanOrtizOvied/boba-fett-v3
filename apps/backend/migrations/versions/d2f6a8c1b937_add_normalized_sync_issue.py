"""add_normalized_sync_issue

Revision ID: d2f6a8c1b937
Revises: a7d3b9e2c481
Create Date: 2026-11-10 00:00:00.000000

Rows of the workbook that the normalized catalog sync could not apply: a skipped
row (a number column with text, a blank required cell, a repeated key) or a row
whose product or series parent was not found. One issue per row, kept until the
workbook is fixed: it is a condition that lasts, not an event of one run, so it
lives apart from `normalized_sync_event`. `problems` is the list of the row's bad
cells as of the last run; the issue is resolved (not deleted) when a run no longer
finds the row among the unread ones. `first_seen_by` and `resolved_by` hold who
saved the workbook at those moments (an email, 'unknown', or NULL for a run from
a local file). No foreign keys, so it survives any delete. The DDL mirrors
`src/db/schema.sql` verbatim and is idempotent (IF NOT EXISTS), because a deployed
backend runs `alembic upgrade head`, not `schema.sql`.
"""

from alembic import op

revision = "d2f6a8c1b937"
down_revision = "a7d3b9e2c481"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS normalized_sync_issue (
            id BIGSERIAL PRIMARY KEY,
            sheet TEXT NOT NULL,
            level TEXT NOT NULL CHECK (level IN ('product', 'series', 'admin')),
            row_key TEXT NOT NULL,
            product_code TEXT,
            series TEXT,
            administrator TEXT,
            row_number INTEGER NOT NULL,
            problems JSONB NOT NULL,
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at TIMESTAMPTZ,
            first_seen_by TEXT,
            resolved_by TEXT
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS normalized_sync_issue_open_idx "
        "ON normalized_sync_issue (sheet, row_key) WHERE resolved_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS normalized_sync_issue_seen_idx "
        "ON normalized_sync_issue (first_seen_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS normalized_sync_issue_resolved_idx "
        "ON normalized_sync_issue (resolved_at)"
    )


def downgrade() -> None:
    # Dropping the table drops its indexes too.
    op.execute("DROP TABLE IF EXISTS normalized_sync_issue")
