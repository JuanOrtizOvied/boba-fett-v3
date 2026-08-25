"""add_slugs_to_product_catalog

Revision ID: c3d4e5f6a1b2
Revises: b2c3d4e5f6a1
Create Date: 2026-08-25 00:00:01.123456
"""

from alembic import op

revision = "c3d4e5f6a1b2"
down_revision = "b2c3d4e5f6a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # slugs: server-computed array of name + alternative_names, each run
    # through normalize_catalog_text (lower + unaccent, from the
    # enable_search_extensions migration). Populated by the application on
    # every insert/update from here on (see CatalogRepository) — this
    # migration only adds the column and backfills existing rows so legacy
    # catalog entries aren't left without it.
    op.execute("""
        ALTER TABLE product_catalog
        ADD COLUMN IF NOT EXISTS slugs text[] DEFAULT '{}';
    """)

    op.execute("""
        UPDATE product_catalog
        SET slugs = (
            SELECT COALESCE(ARRAY_AGG(DISTINCT normalize_catalog_text(btrim(v))), '{}')
            FROM unnest(
                array_prepend(name, COALESCE(alternative_names, '{}'::text[]))
            ) AS v
            WHERE v IS NOT NULL AND btrim(v) <> ''
        );
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE product_catalog DROP COLUMN IF EXISTS slugs;")
