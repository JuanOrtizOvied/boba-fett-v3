"""enable_search_extensions

Revision ID: a1b2c3d4e5f6
Revises: fc163426f0af
Create Date: 2024-08-04 00:00:01.123456
"""

import sqlalchemy as sa
from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "fc163426f0af"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Habilitar extensiones
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent;")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")

    # Crear función de normalización
    op.execute("""
    CREATE OR REPLACE FUNCTION normalize_catalog_text(input_text text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
    AS $$
        SELECT lower(unaccent(input_text));
    $$;
    """)

def downgrade() -> None:
    # Eliminar la función
    op.execute("DROP FUNCTION IF EXISTS normalize_catalog_text;")
    # Nota: Las extensiones unaccent y pg_trgm no se eliminarán para evitar afectar otros objetos.
