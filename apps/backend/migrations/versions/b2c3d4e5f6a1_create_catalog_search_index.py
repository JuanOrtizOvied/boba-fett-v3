"""create_catalog_search_index

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2024-08-04 00:00:01.123456
"""

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a1"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Crear índice trigrama sobre la expresión de normalización
    # Se utiliza array_to_string para la concatenación de los alias
    op.execute("""
    CREATE INDEX idx_product_catalog_name_trgm ON product_catalog USING gin (name gin_trgm_ops);
    """)

def downgrade() -> None:
    # Eliminar el índice
    op.execute("DROP INDEX IF EXISTS idx_product_catalog_name_trgm;")
