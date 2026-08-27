"""add_catalog_slugs_trgm_index

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-08-27 00:00:00.000000
"""

from alembic import op

revision = "e5f6a1b2c3d4"
down_revision = "d4e5f6a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `get_catalog()` (db/catalog_repository.py) now searches `slugs`
    # (already-normalized name + alternative_names) via
    # `catalog_slugs_text(slugs) LIKE '%...%'`. array_to_string() itself is
    # STABLE, not IMMUTABLE, so Postgres rejects it directly inside an index
    # expression (42P17) — wrap it in a SQL function explicitly declared
    # IMMUTABLE, same technique as normalize_catalog_text() wrapping
    # unaccent() in the `enable_search_extensions` migration.
    op.execute("""
        CREATE OR REPLACE FUNCTION catalog_slugs_text(input_slugs text[])
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        AS $$
            SELECT array_to_string(input_slugs, ' ');
        $$;
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_catalog_slugs_trgm
        ON product_catalog USING gin (catalog_slugs_text(slugs) gin_trgm_ops);
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_catalog_slugs_trgm;")
    op.execute("DROP FUNCTION IF EXISTS catalog_slugs_text(text[]);")
