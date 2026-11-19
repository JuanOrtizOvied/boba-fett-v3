"""update_administrator_manager_tables

Revision ID: e3a7c5b9d102
Revises: b6e1c9f3a874
Create Date: 2026-11-19 00:00:00.000000

Brings the `administrator` and `manager` tables to name, score, slugs and
timestamps:

- `administrator.score_is_fixed` is dropped. It only said that "Cash o efectivo"
  has no fixed score (its risk depends on the bank that holds the cash), which the
  empty score already says; the per product score lives in
  `product_catalog.administrator_score`.
- Both tables get `slugs`, a JSONB array with the kebab-case slug of the name (the
  same array shape the allocation items of the normalized catalog use), and
  `updated_at`.
- The rows that already exist are filled: `slugs` with the same rule as
  `slugify_name` (the SQL `normalize_catalog_text` from the search extensions
  migration, then every run of characters outside a-z and 0-9 becomes one `-`, with
  the ends trimmed), and `updated_at` with their `created_at`.

The statements mirror `src/db/schema.sql` and are idempotent (IF EXISTS, IF NOT
EXISTS, and a backfill that only touches rows still empty), because a deployed
backend runs `alembic upgrade head`, not `schema.sql`.
"""

from alembic import op

revision = "e3a7c5b9d102"
down_revision = "b6e1c9f3a874"
branch_labels = None
depends_on = None

_TABLES = ("administrator", "manager")


def upgrade() -> None:
    op.execute("ALTER TABLE administrator DROP COLUMN IF EXISTS score_is_fixed")
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS slugs JSONB NOT NULL DEFAULT '[]'::jsonb"
        )
        # Added without a default first so the rows that already exist take their
        # creation time and not the time of this migration.
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ")
        op.execute(
            f"UPDATE {table} SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL"
        )
        op.execute(f"ALTER TABLE {table} ALTER COLUMN updated_at SET DEFAULT now()")
        op.execute(
            f"""
            UPDATE {table} AS t
            SET slugs = CASE WHEN s.slug = '' THEN '[]'::jsonb ELSE jsonb_build_array(s.slug) END
            FROM (
                SELECT id, trim(both '-' from regexp_replace(
                    normalize_catalog_text(name), '[^a-z0-9]+', '-', 'g'
                )) AS slug
                FROM {table}
            ) AS s
            WHERE t.id = s.id AND t.slugs = '[]'::jsonb
            """
        )


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS updated_at")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS slugs")
    op.execute(
        "ALTER TABLE administrator ADD COLUMN IF NOT EXISTS "
        "score_is_fixed BOOLEAN NOT NULL DEFAULT true"
    )
    op.execute("UPDATE administrator SET score_is_fixed = false WHERE name = 'Cash o efectivo'")
