"""add_deleted_at_to_administrator_manager

Revision ID: b7d3f1a9c245
Revises: e3a7c5b9d102
Create Date: 2026-11-20 00:00:00.000000

Adds the soft delete marker to `administrator` and `manager`: a nullable
`deleted_at`, where null means the row is active and a timestamp says when it was
deleted. A deleted row stays in the table (its name stays taken, because `name` is
`UNIQUE`) and can be restored by clearing the column.

The rows that already exist stay active. The statements mirror `src/db/schema.sql` and
are idempotent, because a deployed backend runs `alembic upgrade head`, not `schema.sql`.
"""

from alembic import op

revision = "b7d3f1a9c245"
down_revision = "e3a7c5b9d102"
branch_labels = None
depends_on = None

_TABLES = ("administrator", "manager")


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS deleted_at")
