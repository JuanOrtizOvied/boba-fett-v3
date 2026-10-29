"""add_normalized_sync_state

Revision ID: d8f2a4c6b1e3
Revises: a7c1e2d3f4b5
Create Date: 2026-10-23 00:00:00.000000

One-row table that holds the hash of the last workbook the normalized catalog
SharePoint sync applied, so an unchanged file is skipped. It is separate from
`webhook_subscriptions.last_processed_hash`, which belongs to the sync of
`product_catalog` and tracks another file.
"""

import sqlalchemy as sa
from alembic import op

revision = "d8f2a4c6b1e3"
down_revision = "a7c1e2d3f4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "normalized_sync_state",
        sa.Column(
            "id",
            sa.SmallInteger,
            primary_key=True,
            server_default=sa.text("1"),
        ),
        sa.Column("last_processed_hash", sa.String(64), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("id = 1", name="ck_normalized_sync_state_single_row"),
    )


def downgrade() -> None:
    op.drop_table("normalized_sync_state")
