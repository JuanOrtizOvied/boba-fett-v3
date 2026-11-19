"""add_property_holding

Revision ID: b6e1c9f3a874
Revises: d2f6a8c1b937
Create Date: 2026-11-18 00:00:00.000000

Tables of the properties section, fed from the sheet `6. Propiedades` of the
SharePoint workbook. `property_holding` has one row per `(code, client)`, the grain
of the sheet: a property owned by two clients has two rows, and the API groups them
by code. Number columns are nullable (a blank cell or a `-` is stored as NULL). A row
that leaves the sheet is soft deleted (`is_deleted`) and restored if it comes back.
`properties_sync_state` holds the hash of the last workbook applied, so an unchanged
file is skipped; one row only, kept apart from `normalized_sync_state`. No foreign
keys to any other table: nothing of the catalog changes. The DDL mirrors
`src/db/schema.sql` verbatim and is idempotent (IF NOT EXISTS), because a deployed
backend runs `alembic upgrade head`, not `schema.sql`.
"""

from alembic import op

revision = "b6e1c9f3a874"
down_revision = "d2f6a8c1b937"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS property_holding (
            id SERIAL PRIMARY KEY,
            code TEXT NOT NULL,
            client TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            manager TEXT DEFAULT '',
            administrator TEXT DEFAULT '',
            asset_class JSONB DEFAULT '[]',
            geographic_focus JSONB DEFAULT '[]',
            underlying JSONB DEFAULT '[]',
            currency TEXT DEFAULT '',
            investment_horizon TEXT DEFAULT '',
            usage TEXT DEFAULT '',
            flows_min NUMERIC,
            flows_max NUMERIC,
            return_min NUMERIC,
            return_max NUMERIC,
            ownership_pct NUMERIC,
            estimated_value_usd NUMERIC,
            monthly_rent_usd NUMERIC,
            is_deleted BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE (code, client)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS properties_sync_state (
            id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            last_processed_hash VARCHAR(64),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    # Dropping a table drops its indexes and constraints too.
    op.execute("DROP TABLE IF EXISTS properties_sync_state")
    op.execute("DROP TABLE IF EXISTS property_holding")
