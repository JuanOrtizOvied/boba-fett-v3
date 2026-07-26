"""asset_class text to jsonb array

Revision ID: 80264323fe4b
Revises: 8f2a91c4d6b7
Create Date: 2026-07-25 19:23:03.807206

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '80264323fe4b'
down_revision = '8f2a91c4d6b7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- products.asset_class: TEXT -> JSONB with data backfill --
    # Backfill plain text values (e.g. "inversiones_directas") to a JSON array
    # of a single {name, percentage: 100} allocation before the type change.
    op.execute(
        """
        UPDATE products
        SET asset_class = CASE
            WHEN asset_class IS NOT NULL AND asset_class != ''
            THEN jsonb_build_array(jsonb_build_object('name', asset_class, 'percentage', 100))::text
            ELSE '[]'
        END
        """
    )
    op.execute("ALTER TABLE products ALTER COLUMN asset_class DROP DEFAULT")
    op.alter_column(
        'products', 'asset_class',
        existing_type=sa.TEXT(),
        type_=postgresql.JSONB(astext_type=sa.Text()),
        existing_nullable=False,
        postgresql_using="asset_class::jsonb",
    )
    op.execute("ALTER TABLE products ALTER COLUMN asset_class SET DEFAULT '[]'::jsonb")

    # -- product_catalog.asset_class: TEXT -> JSONB with data backfill --
    op.execute(
        """
        UPDATE product_catalog
        SET asset_class = CASE
            WHEN asset_class IS NOT NULL AND asset_class != ''
            THEN jsonb_build_array(jsonb_build_object('name', asset_class, 'percentage', 100))::text
            ELSE '[]'
        END
        """
    )
    op.execute("ALTER TABLE product_catalog ALTER COLUMN asset_class DROP DEFAULT")
    op.alter_column(
        'product_catalog', 'asset_class',
        existing_type=sa.TEXT(),
        type_=postgresql.JSONB(astext_type=sa.Text()),
        existing_nullable=True,
        postgresql_using="asset_class::jsonb",
    )
    op.execute("ALTER TABLE product_catalog ALTER COLUMN asset_class SET DEFAULT '[]'::jsonb")


def downgrade() -> None:
    # -- product_catalog.asset_class: JSONB -> TEXT (collapse to first name) --
    op.execute("ALTER TABLE product_catalog ALTER COLUMN asset_class DROP DEFAULT")
    op.alter_column(
        'product_catalog', 'asset_class',
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        type_=sa.TEXT(),
        existing_nullable=True,
        postgresql_using="COALESCE(asset_class->0->>'name', '')",
    )
    op.execute("ALTER TABLE product_catalog ALTER COLUMN asset_class SET DEFAULT ''::text")

    # -- products.asset_class: JSONB -> TEXT (collapse to first name) --
    op.execute("ALTER TABLE products ALTER COLUMN asset_class DROP DEFAULT")
    op.alter_column(
        'products', 'asset_class',
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        type_=sa.TEXT(),
        existing_nullable=False,
        postgresql_using="COALESCE(asset_class->0->>'name', '')",
    )
    op.execute("ALTER TABLE products ALTER COLUMN asset_class SET DEFAULT ''::text")
