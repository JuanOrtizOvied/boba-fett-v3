"""add_isin_distribution_fields

Revision ID: f6a1b2c3d4e5
Revises: e5f6a1b2c3d4
Create Date: 2026-09-09 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "f6a1b2c3d4e5"
down_revision = "e5f6a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products", sa.Column("isin", sa.Text, nullable=False, server_default="")
    )
    op.add_column(
        "products",
        sa.Column("distribution", sa.Text, nullable=False, server_default=""),
    )
    op.add_column(
        "product_catalog",
        sa.Column("isin", sa.Text, nullable=False, server_default=""),
    )
    op.add_column(
        "product_catalog",
        sa.Column("distribution", sa.Text, nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("product_catalog", "distribution")
    op.drop_column("product_catalog", "isin")
    op.drop_column("products", "distribution")
    op.drop_column("products", "isin")
