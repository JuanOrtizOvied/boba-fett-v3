"""add_soft_delete_codigo_cash_flows

Revision ID: a7c3e91d5b24
Revises: 8dd9733f267d
Create Date: 2026-09-25 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "a7c3e91d5b24"
down_revision = "8dd9733f267d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "product_catalog",
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    # Nullable on purpose: existing rows keep codigo = NULL until the seeding
    # step assigns codes. UNIQUE allows multiple NULLs in PostgreSQL.
    op.add_column("product_catalog", sa.Column("codigo", sa.String(20), nullable=True))
    op.create_index("uq_product_catalog_codigo", "product_catalog", ["codigo"], unique=True)
    op.add_column(
        "product_catalog",
        sa.Column("cash_flows", sa.Text, nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("product_catalog", "cash_flows")
    op.drop_index("uq_product_catalog_codigo", table_name="product_catalog")
    op.drop_column("product_catalog", "codigo")
    op.drop_column("product_catalog", "is_deleted")
