"""allow_admin_ficha_import_source

Revision ID: f6a1b2c3d4e5
Revises: e5f6a1b2c3d4
Create Date: 2026-09-04 00:00:00.000000
"""

from alembic import op

revision = "f6a1b2c3d4e5"
down_revision = "e5f6a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ficha Patrimonial bulk import tags every created product with
    # `source='admin_ficha_import'` (`sdd/admin-ficha-patrimonial/spec` —
    # "Confirm creates all products"). Widen the existing check constraint
    # to allow this new value alongside 'agent', 'api', 'admin'.
    op.drop_constraint("changes_source_check", "portfolio_changes", type_="check")
    op.create_check_constraint(
        "changes_source_check",
        "portfolio_changes",
        "source IN ('agent', 'api', 'admin', 'admin_ficha_import')",
    )


def downgrade() -> None:
    op.drop_constraint("changes_source_check", "portfolio_changes", type_="check")
    op.create_check_constraint(
        "changes_source_check",
        "portfolio_changes",
        "source IN ('agent', 'api', 'admin')",
    )
