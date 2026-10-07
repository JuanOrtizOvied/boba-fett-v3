"""fix_v2_entity_name_spacing

Catalog v2 (`openspec/changes/catalog-v2-sharepoint-sync`): the one-time copy of
the administrators kept the current spelling "S &T Comunicaciones Integral",
while the manager table and the workbook write "S&T Comunicaciones Integral".
It is the same entity, so the stored name is aligned with the workbook. Only the
v2 entity table is touched, and only when the correct spelling is not there yet.

Revision ID: 7b2d4c9e1a35
Revises: 3f9a7c1d2b84
Create Date: 2026-10-06 00:00:00.000000
"""

from alembic import op

revision = "7b2d4c9e1a35"
down_revision = "3f9a7c1d2b84"
branch_labels = None
depends_on = None

BEFORE = "S &T Comunicaciones Integral"
AFTER = "S&T Comunicaciones Integral"


def upgrade() -> None:
    op.execute(
        f"UPDATE administrator_v2 SET name = '{AFTER}' WHERE name = '{BEFORE}' "
        f"AND NOT EXISTS (SELECT 1 FROM administrator_v2 WHERE name = '{AFTER}')"
    )


def downgrade() -> None:
    op.execute(
        f"UPDATE administrator_v2 SET name = '{BEFORE}' WHERE name = '{AFTER}' "
        f"AND NOT EXISTS (SELECT 1 FROM administrator_v2 WHERE name = '{BEFORE}')"
    )
