"""add_file_storage_to_ficha

Revision ID: e7f8a9b0c1d2
Revises: c7d8e9f0a1b2
Create Date: 2026-11-06 00:00:00.000000

Keep the original uploaded ficha `.xlsx` so the admin can download it later.
`file_data` holds the raw bytes (nullable — older fichas have none); `file_name`
is the original upload name.
"""

import sqlalchemy as sa
from alembic import op

revision = "e7f8a9b0c1d2"
down_revision = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ficha", sa.Column("file_data", sa.LargeBinary, nullable=True))
    op.add_column(
        "ficha",
        sa.Column("file_name", sa.Text, nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("ficha", "file_name")
    op.drop_column("ficha", "file_data")
