"""backfill_catalog_allocation_slugs

Add a server-computed, kebab-case `slugs` array to every JSON item of the
normalized `catalog_product` JSONB fields asset_class / geographic_focus /
underlying, derived from the item's `name`. No DDL: the columns are already
JSONB; this only enriches the stored item payloads so existing rows carry the
same `slugs` the application now computes on every read/write (see
`db/catalog_normalized.py` `slugify_name` / `CatalogAllocation`).

The SQL slug mirrors `slugify_name`: unaccent + lowercase (normalize_catalog_text,
from the enable_search_extensions migration), then every run of non-alphanumeric
characters collapses to a single '-', with leading/trailing '-' trimmed.

Revision ID: a9c1e3f5b7d2
Revises: f8a9b0c1d2e3
Create Date: 2026-11-13 00:00:00.000000
"""

from alembic import op

revision = "a9c1e3f5b7d2"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Maps a JSONB allocation array to the same array with a server-computed
    # `slugs` key added to each item (order preserved). Empty/blank name -> [].
    op.execute(
        """
        CREATE OR REPLACE FUNCTION catalog_allocation_with_slugs(items jsonb)
        RETURNS jsonb
        LANGUAGE sql
        IMMUTABLE
        AS $$
            SELECT COALESCE(
                jsonb_agg(
                    elem || jsonb_build_object(
                        'slugs',
                        CASE
                            WHEN slug = '' THEN '[]'::jsonb
                            ELSE jsonb_build_array(slug)
                        END
                    )
                    ORDER BY ord
                ),
                '[]'::jsonb
            )
            FROM jsonb_array_elements(items) WITH ORDINALITY AS t(elem, ord),
            LATERAL (
                SELECT trim(both '-' from regexp_replace(
                    normalize_catalog_text(COALESCE(elem->>'name', '')),
                    '[^a-z0-9]+', '-', 'g'
                )) AS slug
            ) s;
        $$;
        """
    )

    for column in ("asset_class", "geographic_focus", "underlying"):
        op.execute(
            f"""
            UPDATE catalog_product
            SET {column} = catalog_allocation_with_slugs({column})
            WHERE jsonb_array_length({column}) > 0;
            """
        )


def downgrade() -> None:
    for column in ("asset_class", "geographic_focus", "underlying"):
        op.execute(
            f"""
            UPDATE catalog_product
            SET {column} = (
                SELECT COALESCE(jsonb_agg(elem - 'slugs' ORDER BY ord), '[]'::jsonb)
                FROM jsonb_array_elements({column}) WITH ORDINALITY AS t(elem, ord)
            )
            WHERE jsonb_array_length({column}) > 0;
            """
        )
    op.execute("DROP FUNCTION IF EXISTS catalog_allocation_with_slugs(jsonb);")
