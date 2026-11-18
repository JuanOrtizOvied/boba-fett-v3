"""add_changed_by_to_normalized_sync_event

Revision ID: a7d3b9e2c481
Revises: c4e8a1b7d205
Create Date: 2026-11-10 00:00:00.000000

Who saved the workbook that a sync run read, stored with every event of the run.
Holds the corporate email in lower case, the marker 'unknown' when the author of
a SharePoint run could not be determined, or NULL when there is no data (events
stored before this column existed and runs started from a local file). Nullable
and without a default, so existing rows are left as they are. The DDL mirrors
`src/db/schema.sql` verbatim and is idempotent, because a deployed backend runs
`alembic upgrade head`, not `schema.sql`.
"""

from alembic import op

revision = "a7d3b9e2c481"
down_revision = "c4e8a1b7d205"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE normalized_sync_event ADD COLUMN IF NOT EXISTS changed_by TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE normalized_sync_event DROP COLUMN IF EXISTS changed_by")
