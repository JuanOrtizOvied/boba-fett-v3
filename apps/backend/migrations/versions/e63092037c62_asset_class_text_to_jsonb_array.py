"""asset_class text to jsonb array

Revision ID: e63092037c62
Revises: 80264323fe4b
Create Date: 2026-07-25 20:44:53.001503

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'e63092037c62'
down_revision = '80264323fe4b'
branch_labels = None
depends_on = None


def _is_text_column(table: str, column: str) -> bool:
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    row = result.fetchone()
    return row is not None and row[0] == "text"


def upgrade() -> None:
    # -- products: asset_class TEXT -> JSONB with backfill --
    if _is_text_column("products", "asset_class"):
        op.execute("""
            UPDATE products
            SET asset_class = CASE
                WHEN asset_class IS NOT NULL AND asset_class != ''
                THEN jsonb_build_array(jsonb_build_object('name', asset_class, 'percentage', 100))::text
                ELSE '[]'
            END
        """)
        op.execute("ALTER TABLE products ALTER COLUMN asset_class DROP DEFAULT")
        op.alter_column('products', 'asset_class',
                   existing_type=sa.TEXT(),
                   type_=postgresql.JSONB(astext_type=sa.Text()),
                   existing_nullable=False,
                   postgresql_using="asset_class::jsonb")
        op.execute("ALTER TABLE products ALTER COLUMN asset_class SET DEFAULT '[]'::jsonb")

    # -- product_catalog: asset_class TEXT -> JSONB with backfill --
    if _is_text_column("product_catalog", "asset_class"):
        op.execute("""
            UPDATE product_catalog
            SET asset_class = CASE
                WHEN asset_class IS NOT NULL AND asset_class != ''
                THEN jsonb_build_array(jsonb_build_object('name', asset_class, 'percentage', 100))::text
                ELSE '[]'
            END
        """)
        op.execute("ALTER TABLE product_catalog ALTER COLUMN asset_class DROP DEFAULT")
        op.alter_column('product_catalog', 'asset_class',
                   existing_type=sa.TEXT(),
                   type_=postgresql.JSONB(astext_type=sa.Text()),
                   existing_nullable=True,
                   postgresql_using="asset_class::jsonb")
        op.execute("ALTER TABLE product_catalog ALTER COLUMN asset_class SET DEFAULT '[]'::jsonb")


def downgrade() -> None:
    op.alter_column('product_catalog', 'asset_class',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               type_=sa.TEXT(),
               existing_nullable=True,
               postgresql_using="COALESCE((asset_class->0->>'name'), '')")
    op.execute("ALTER TABLE product_catalog ALTER COLUMN asset_class SET DEFAULT ''")

    op.alter_column('products', 'asset_class',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               type_=sa.TEXT(),
               existing_nullable=False,
               postgresql_using="COALESCE((asset_class->0->>'name'), 'otros')")
    op.execute("ALTER TABLE products ALTER COLUMN asset_class SET DEFAULT ''")
