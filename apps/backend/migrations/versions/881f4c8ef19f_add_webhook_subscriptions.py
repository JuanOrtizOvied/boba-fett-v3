"""add_webhook_subscriptions

Revision ID: 881f4c8ef19f
Revises: a7c3e91d5b24
Create Date: 2026-09-30 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "881f4c8ef19f"
down_revision = "a7c3e91d5b24"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhook_subscriptions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("subscription_id", sa.String(255), nullable=False, unique=True),
        sa.Column("client_state", sa.String(255), nullable=False),
        sa.Column("expiration", sa.DateTime(timezone=True), nullable=False),
        sa.Column("drive_item_id", sa.String(255), nullable=False),
        sa.Column("last_processed_hash", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "idx_webhook_subs_expiration", "webhook_subscriptions", ["expiration"]
    )


def downgrade() -> None:
    op.drop_index("idx_webhook_subs_expiration", table_name="webhook_subscriptions")
    op.drop_table("webhook_subscriptions")
