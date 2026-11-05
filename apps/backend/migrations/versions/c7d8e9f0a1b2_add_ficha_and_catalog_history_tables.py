"""add_ficha_and_catalog_history_tables

Revision ID: c7d8e9f0a1b2
Revises: b9d4f6a8c2e1
Create Date: 2026-11-04 00:00:00.000000

Creates the ficha-patrimonial tables (`ficha`, `ficha_line`) and the V2 catalog
change history (`catalog_product_history`). These were added to `schema.sql` on
the ficha branch but never mirrored into an Alembic migration, so a deployed
backend (which runs `alembic upgrade head`, not `schema.sql`) was missing them —
the `POST /admin/ficha-patrimonial/parse` endpoint 500s because `ficha` does not
exist. DDL mirrors `src/db/schema.sql` verbatim and is idempotent (IF NOT
EXISTS) so it is safe on a database that already has the tables.
"""

from alembic import op

revision = "c7d8e9f0a1b2"
down_revision = "b9d4f6a8c2e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ficha (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id),
            client_name TEXT NOT NULL DEFAULT '',
            client_email TEXT NOT NULL DEFAULT '',
            client_phone TEXT NOT NULL DEFAULT '',
            parse_failed BOOLEAN NOT NULL DEFAULT false,
            confirmed BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ficha_line (
            id SERIAL PRIMARY KEY,
            ficha_id INTEGER NOT NULL REFERENCES ficha(id) ON DELETE CASCADE,
            excel_row INTEGER NOT NULL,
            raw_name TEXT NOT NULL DEFAULT '',
            raw_tipo_activo TEXT NOT NULL DEFAULT '',
            raw_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
            raw_currency TEXT NOT NULL DEFAULT '',
            raw_return_rate TEXT NOT NULL DEFAULT '',
            raw_pertenencia TEXT NOT NULL DEFAULT '',
            mapped_asset_class TEXT,
            normalized_return_rate TEXT NOT NULL DEFAULT '',
            enriched JSONB,
            line_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (line_status IN ('pending', 'approved', 'discarded'))
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ficha_line_ficha_id_idx ON ficha_line (ficha_id)"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS catalog_product_history (
            id SERIAL PRIMARY KEY,
            product_code TEXT NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('create', 'update')),
            changed_by UUID REFERENCES users(id),
            source TEXT NOT NULL DEFAULT 'ficha',
            changes JSONB NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS catalog_product_history_code_idx "
        "ON catalog_product_history (product_code)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS catalog_product_history")
    op.execute("DROP TABLE IF EXISTS ficha_line")
    op.execute("DROP TABLE IF EXISTS ficha")
