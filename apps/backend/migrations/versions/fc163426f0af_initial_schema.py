"""initial schema

Revision ID: fc163426f0af
Revises:
Create Date: 2026-07-21
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "fc163426f0af"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False, server_default="user"),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("active_thread_id", sa.Text()),
        sa.CheckConstraint("role IN ('user', 'admin')", name="users_role_check"),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_refresh_tokens_user", "refresh_tokens", ["user_id"])

    op.create_table(
        "products",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), server_default=""),
        sa.Column("amount", sa.Numeric(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("underlying", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("asset_class", sa.Text(), server_default=""),
        sa.Column("geographic_focus", sa.Text(), server_default=""),
        sa.Column("commission", sa.Text(), server_default=""),
        sa.Column("currency", sa.Text(), server_default=""),
        sa.Column("administrator", sa.Text(), server_default=""),
        sa.Column("manager", sa.Text(), server_default=""),
        sa.Column("liquidity", sa.Text(), server_default=""),
        sa.Column("return_rate", sa.Text(), server_default=""),
        sa.Column("catalog_product_id", sa.Integer()),
        sa.CheckConstraint("amount > 0", name="products_amount_positive"),
    )
    op.create_index("idx_products_user", "products", ["user_id"])
    op.create_index("idx_products_catalog_product_id", "products", ["catalog_product_id"])

    op.create_table(
        "product_catalog",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("geographic_focus", sa.Text(), server_default=""),
        sa.Column("asset_class", sa.Text(), server_default=""),
        sa.Column("underlying", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
        sa.Column("commission", sa.Text(), server_default=""),
        sa.Column("currency", sa.Text(), server_default=""),
        sa.Column("administrator", sa.Text(), server_default=""),
        sa.Column("manager", sa.Text(), server_default=""),
        sa.Column("liquidity", sa.Text(), server_default=""),
        sa.Column("return_rate", sa.Text(), server_default=""),
        sa.Column("category", sa.Text(), server_default=""),
        sa.Column("approved_from_product_id", sa.Text()),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("alternative_names", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]")),
    )
    op.create_index(
        "idx_catalog_name_trgm",
        "product_catalog",
        ["name"],
        postgresql_using="gin",
        postgresql_ops={"name": "gin_trgm_ops"},
    )

    op.create_table(
        "portfolio_snapshots",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("product_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("total_amount", sa.Numeric(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("category_summary", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
    )
    op.create_index(
        "idx_snapshots_user_created",
        "portfolio_snapshots",
        [sa.text("user_id"), sa.text("created_at DESC")],
    )

    op.create_table(
        "snapshot_products",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("snapshot_id", sa.UUID(), sa.ForeignKey("portfolio_snapshots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.Text(), nullable=False),
        sa.Column("product_data", postgresql.JSONB(), nullable=False),
    )
    op.create_index("idx_snapshot_products_snapshot", "snapshot_products", ["snapshot_id"])
    op.create_index("idx_snapshot_products_product_id", "snapshot_products", ["product_id"])

    op.create_table(
        "portfolio_changes",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.Text()),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("before_state", postgresql.JSONB()),
        sa.Column("after_state", postgresql.JSONB()),
        sa.Column("source", sa.Text(), nullable=False, server_default="api"),
        sa.Column("snapshot_id", sa.UUID(), sa.ForeignKey("portfolio_snapshots.id", ondelete="SET NULL")),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("operation IN ('create', 'update', 'delete')", name="changes_operation_check"),
        sa.CheckConstraint("source IN ('agent', 'api', 'admin')", name="changes_source_check"),
    )
    op.create_index(
        "idx_changes_user_created",
        "portfolio_changes",
        [sa.text("user_id"), sa.text("created_at DESC")],
    )
    op.create_index("idx_changes_product", "portfolio_changes", ["product_id"])
    op.create_index(
        "idx_changes_snapshot",
        "portfolio_changes",
        ["snapshot_id"],
        postgresql_where=sa.text("snapshot_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_table("portfolio_changes")
    op.drop_table("snapshot_products")
    op.drop_table("portfolio_snapshots")
    op.drop_table("product_catalog")
    op.drop_table("products")
    op.drop_table("refresh_tokens")
    op.drop_table("users")
