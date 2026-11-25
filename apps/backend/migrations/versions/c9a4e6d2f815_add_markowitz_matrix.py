"""add_markowitz_matrix

Revision ID: c9a4e6d2f815
Revises: b7d3f1a9c245
Create Date: 2026-11-24 00:00:00.000000

Adds the tables for the Markowitz correlation matrix of asset classes:

- `markowitz_asset`: one row per asset class (name, slugs used as aliases, and the
  `position` that orders both the rows and the columns of the matrix).
- `markowitz_correlation`: one row per cell, `(row_asset_id, col_asset_id, value)`, with both
  directions stored, so a pair that is not symmetric can be told apart and corrected.

The database refuses a value outside -1 to 1 and a diagonal cell that is not 1. That every
pair exists (a complete matrix) is kept by the application, inside the transaction that adds
an asset. Both tables start empty: the rows are loaded afterwards by a one-off script.

The statements mirror `src/db/schema.sql` and are idempotent, because a deployed backend
runs `alembic upgrade head`, not `schema.sql`.
"""

from alembic import op

revision = "c9a4e6d2f815"
down_revision = "b7d3f1a9c245"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS markowitz_asset (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            slugs JSONB NOT NULL DEFAULT '[]'::jsonb,
            position INTEGER NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS markowitz_correlation (
            row_asset_id INTEGER NOT NULL REFERENCES markowitz_asset(id) ON DELETE RESTRICT,
            col_asset_id INTEGER NOT NULL REFERENCES markowitz_asset(id) ON DELETE RESTRICT,
            value NUMERIC(5, 4) NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (row_asset_id, col_asset_id),
            CONSTRAINT markowitz_correlation_value_range CHECK (value BETWEEN -1 AND 1),
            CONSTRAINT markowitz_correlation_diagonal CHECK (
                row_asset_id <> col_asset_id OR value = 1
            )
        )
        """
    )
    # The primary key already serves lookups by row; this one serves lookups by column.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_markowitz_correlation_col "
        "ON markowitz_correlation (col_asset_id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS markowitz_correlation")
    op.execute("DROP TABLE IF EXISTS markowitz_asset")
