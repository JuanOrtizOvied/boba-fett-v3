"""widen_product_catalog_codigo

`product_catalog.codigo` was created as VARCHAR(20), enough for a plain code such as
"BD-00001". The v2 workbook keys a class row as "<code>|<series>" and an administrator row
as "<code>|<administrator>", which can be longer (the administrator names reach 37
characters). The column is widened to 50 so those keys fit.

Widening a VARCHAR keeps the data and the unique index `uq_product_catalog_codigo` as they
are. The downgrade narrows it back and fails if a longer code is already stored.

Revision ID: 9c4e7a2b5d16
Revises: 7b2d4c9e1a35
Create Date: 2026-10-15 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "9c4e7a2b5d16"
down_revision = "7b2d4c9e1a35"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "product_catalog",
        "codigo",
        existing_type=sa.String(20),
        type_=sa.String(50),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "product_catalog",
        "codigo",
        existing_type=sa.String(50),
        type_=sa.String(20),
        existing_nullable=True,
    )
