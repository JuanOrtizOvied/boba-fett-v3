"""add_name_to_users

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-11-08 00:00:00.000000

Store a client's first and last name on `users` (created from the ficha
confirm flow). Default `''` keeps existing rows valid.
"""

import sqlalchemy as sa
from alembic import op

revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.Text, nullable=False, server_default=""))
    op.add_column("users", sa.Column("last_name", sa.Text, nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")
