"""add_soft_delete_to_normalized_catalog

Revision ID: b9d4f6a8c2e1
Revises: d8f2a4c6b1e3
Create Date: 2026-10-28 00:00:00.000000

Soft delete for the three normalized catalog tables. A row that leaves the
workbook is kept and flagged, so the same business key can be restored when it
comes back (the UNIQUE constraints stay as they are). `deleted_at` records when
it was flagged.
"""

import sqlalchemy as sa
from alembic import op

revision = "b9d4f6a8c2e1"
down_revision = "d8f2a4c6b1e3"
branch_labels = None
depends_on = None

_TABLES = ("catalog_product", "catalog_product_series", "catalog_product_series_admin")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.false()),
        )
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_column(table, "deleted_at")
        op.drop_column(table, "is_deleted")
