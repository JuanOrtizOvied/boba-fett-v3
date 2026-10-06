"""add_catalog_v2_tables

Catalog v2 (`openspec/changes/catalog-v2-sharepoint-sync`, Phase 1): six new
tables, all suffixed `_v2`, that live next to the v1 catalog without touching
it. `administrator_v2` and `manager_v2` are seeded once from the v1
`administrator` and `manager` tables (keeping their scores); after that there
is no link between them. The three product tables start empty and are filled
only by the v2 workbook sync.

Revision ID: 3f9a7c1d2b84
Revises: 881f4c8ef19f
Create Date: 2026-10-06 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "3f9a7c1d2b84"
down_revision = "881f4c8ef19f"
branch_labels = None
depends_on = None


def _jsonb_list(name: str) -> sa.Column:
    """A JSONB column holding `[{"name", "percentage"}]`, empty by default."""
    return sa.Column(
        name, postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
    )


def _timestamps() -> list[sa.Column]:
    return [
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
    ]


def upgrade() -> None:
    # Search support for the v2 catalog. v2 defines its own functions instead of
    # reusing the v1 ones, so removing v1 never breaks it. The extensions are
    # database-wide and idempotent, and are never dropped on downgrade.
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION normalize_catalog_text_v2(input_text text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        STRICT
        AS $$
            SELECT lower(unaccent(input_text));
        $$;
        """
    )
    # array_to_string() is STABLE, so it cannot be indexed directly; this thin
    # IMMUTABLE wrapper is what the trigram index is built on.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION catalog_slugs_text_v2(input_slugs text[])
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        AS $$
            SELECT array_to_string(input_slugs, ' ');
        $$;
        """
    )

    op.create_table(
        "administrator_v2",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text, nullable=False, unique=True),
        sa.Column("score", sa.Integer),
        sa.Column("score_is_fixed", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_table(
        "manager_v2",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text, nullable=False, unique=True),
        sa.Column("score", sa.Integer),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # One-time copy from v1. Nothing keeps the two in sync afterwards.
    op.execute(
        "INSERT INTO administrator_v2 (name, score, score_is_fixed, created_at) "
        "SELECT name, score, score_is_fixed, COALESCE(created_at, now()) FROM administrator"
    )
    op.execute(
        "INSERT INTO manager_v2 (name, score, created_at) "
        "SELECT name, score, COALESCE(created_at, now()) FROM manager"
    )

    op.create_table(
        "product_catalog_v2",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("codigo", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("isin", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "manager_id",
            sa.Integer,
            sa.ForeignKey("manager_v2.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        _jsonb_list("asset_class"),
        _jsonb_list("geographic_focus"),
        _jsonb_list("underlying"),
        sa.Column("currency", sa.Text, nullable=False, server_default=""),
        sa.Column("investment_horizon", sa.Text, nullable=False, server_default=""),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("false")),
        # Normalized (lower + unaccent) name, computed by Postgres so no write
        # path can forget it. An array so aliases can be added later.
        sa.Column(
            "slugs",
            postgresql.ARRAY(sa.Text),
            sa.Computed(
                "CASE WHEN btrim(name) = '' THEN '{}'::text[] "
                "ELSE ARRAY[normalize_catalog_text_v2(btrim(name))] END",
                persisted=True,
            ),
        ),
        *_timestamps(),
    )
    op.create_index("idx_product_catalog_v2_manager", "product_catalog_v2", ["manager_id"])
    op.execute(
        "CREATE INDEX idx_product_catalog_v2_slugs_trgm ON product_catalog_v2 "
        "USING gin (catalog_slugs_text_v2(slugs) gin_trgm_ops)"
    )

    op.create_table(
        "product_series_v2",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "product_id",
            sa.Integer,
            sa.ForeignKey("product_catalog_v2.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("series", sa.Text, nullable=False, server_default="-"),
        sa.Column("ter", sa.Numeric),
        sa.Column("flows_min", sa.Numeric),
        sa.Column("flows_max", sa.Numeric),
        sa.Column("return_min", sa.Numeric),
        sa.Column("return_max", sa.Numeric),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("false")),
        *_timestamps(),
        sa.UniqueConstraint("product_id", "series", name="uq_product_series_v2_product_series"),
    )

    op.create_table(
        "product_administrator_v2",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "series_id",
            sa.Integer,
            sa.ForeignKey("product_series_v2.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "administrator_id",
            sa.Integer,
            sa.ForeignKey("administrator_v2.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("custody", sa.Numeric),
        sa.Column("buy_commission", sa.Numeric),
        sa.Column("sell_commission", sa.Numeric),
        sa.Column("minimum_usd", sa.Numeric),
        sa.Column("min_commission_usd", sa.Numeric),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.text("false")),
        *_timestamps(),
        sa.UniqueConstraint(
            "series_id", "administrator_id", name="uq_product_administrator_v2_series_admin"
        ),
    )
    op.create_index(
        "idx_product_administrator_v2_administrator", "product_administrator_v2", ["administrator_id"]
    )

    op.create_table(
        "webhook_subscriptions_v2",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("subscription_id", sa.String(255), nullable=False, unique=True),
        sa.Column("client_state", sa.String(255), nullable=False),
        sa.Column("expiration", sa.DateTime(timezone=True), nullable=False),
        sa.Column("drive_item_id", sa.String(255), nullable=False),
        sa.Column("last_processed_hash", sa.String(64), nullable=True),
        *_timestamps(),
    )
    op.create_index(
        "idx_webhook_subs_v2_expiration", "webhook_subscriptions_v2", ["expiration"]
    )


def downgrade() -> None:
    op.drop_index("idx_webhook_subs_v2_expiration", table_name="webhook_subscriptions_v2")
    op.drop_table("webhook_subscriptions_v2")
    op.drop_index(
        "idx_product_administrator_v2_administrator", table_name="product_administrator_v2"
    )
    op.drop_table("product_administrator_v2")
    op.drop_table("product_series_v2")
    op.execute("DROP INDEX IF EXISTS idx_product_catalog_v2_slugs_trgm")
    op.drop_index("idx_product_catalog_v2_manager", table_name="product_catalog_v2")
    op.drop_table("product_catalog_v2")
    op.drop_table("manager_v2")
    op.drop_table("administrator_v2")
    op.execute("DROP FUNCTION IF EXISTS catalog_slugs_text_v2(text[])")
    op.execute("DROP FUNCTION IF EXISTS normalize_catalog_text_v2(text)")
