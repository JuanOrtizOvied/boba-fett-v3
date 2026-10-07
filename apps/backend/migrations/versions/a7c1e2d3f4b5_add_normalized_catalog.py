"""add_normalized_catalog

Revision ID: a7c1e2d3f4b5
Revises: 9c4e7a2b5d16
Create Date: 2026-10-07 00:00:00.000000

Normalized product catalog (producto -> producto x serie -> producto x serie
x administrador), parallel to the legacy flat `product_catalog` table.
NUMERIC fee/commission/flow/return columns store FRACTIONS (0.0384 = 3.84%).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a7c1e2d3f4b5"
down_revision = "9c4e7a2b5d16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_product",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("code", sa.Text, nullable=False, unique=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("ticker_isin", sa.Text, server_default=""),
        sa.Column("manager", sa.Text, server_default=""),
        sa.Column("asset_class", postgresql.JSONB, server_default=sa.text("'[]'::jsonb")),
        sa.Column("geographic_focus", postgresql.JSONB, server_default=sa.text("'[]'::jsonb")),
        sa.Column("underlying", postgresql.JSONB, server_default=sa.text("'[]'::jsonb")),
        sa.Column("currency", sa.Text, server_default=""),
        sa.Column("investment_horizon", sa.Text, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_table(
        "catalog_product_series",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "product_code",
            sa.Text,
            sa.ForeignKey("catalog_product.code", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("series", sa.Text, nullable=False),
        sa.Column("management_fee_ter", sa.Numeric),
        sa.Column("flows_min", sa.Numeric),
        sa.Column("flows_max", sa.Numeric),
        sa.Column("return_min", sa.Numeric),
        sa.Column("return_max", sa.Numeric),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("product_code", "series"),
    )
    op.create_table(
        "catalog_product_series_admin",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("product_code", sa.Text, nullable=False),
        sa.Column("series", sa.Text, nullable=False),
        sa.Column("administrator", sa.Text, nullable=False),
        sa.Column("custody_fee", sa.Numeric),
        sa.Column("buy_commission", sa.Numeric),
        sa.Column("sell_commission", sa.Numeric),
        sa.Column("billing_currency", sa.Text, server_default=""),
        sa.Column("minimum_usd", sa.Numeric),
        sa.Column("min_commission_usd", sa.Numeric),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["product_code", "series"],
            ["catalog_product_series.product_code", "catalog_product_series.series"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("product_code", "administrator", "series"),
    )


def downgrade() -> None:
    op.drop_table("catalog_product_series_admin")
    op.drop_table("catalog_product_series")
    op.drop_table("catalog_product")
