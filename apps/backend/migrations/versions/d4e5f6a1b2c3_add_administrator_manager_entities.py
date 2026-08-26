"""add_administrator_manager_entities

Revision ID: d4e5f6a1b2c3
Revises: c3d4e5f6a1b2
Create Date: 2026-08-25 00:00:02.123456
"""

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a1b2c3"
down_revision = "c3d4e5f6a1b2"
branch_labels = None
depends_on = None

# (name, score) — score is None for "Cash o efectivo" in administrator only:
# its score_is_fixed=false and it's left NULL, entered manually per product
# instead (the real risk depends on which bank holds the cash).
ADMINISTRATORS: list[tuple[str, int | None]] = [
    ("ACRES Sociedad Titulizadora S.A", 5),
    ("AFP Habitat", 8),
    ("Amara Foods EIRL", 2),
    ("American Ventures", 5),
    ("Art Atlas S.R.L", 5),
    ("Aurora Grupo Inmobiliario", 4),
    ("Banco comercio", 5),
    ("Baring", 10),
    ("Barings", 10),
    ("BBVA SAB", 9),
    ("BBVA SAF", 9),
    ("BCP", 9),
    ("Blum SAF", 7),
    ("BNP Paribas", 10),
    ("BNY", 10),
    ("BTG Pactual SAB", 8),
    ("BTG Pactual SAF", 8),
    ("Caja Arequipa", 8),
    ("Caja Huancayo", 5),
    ("Caja Piura", 6),
    ("Cash o efectivo", None),
    ("Celta Contratistas", 4),
    ("Charles Schwab", 10),
    ("Citibank", 10),
    ("Compartamos", 8),
    ("Compass SAF", 8),
    ("Cooperativa Kori", 7),
    ("Core Capital", 6),
    ("Coril", 5),
    ("Coril SAF", 8),
    ("Credicorp Capital SAB", 9),
    ("Credicorp Capital SAF", 9),
    ("El Dorado SAF", 5),
    ("Faro Capital / Edifica", 8),
    ("Fidelity", 10),
    ("Financiera Oh", 6),
    ("Financiera surgir", 6),
    ("Flip", 4),
    ("GSDynamic", 6),
    ("HAPI", 6),
    ("HSBC", 10),
    ("Inteligo Bank", 8),
    ("Inteligo SAB", 9),
    ("Interactive Brokers", 9),
    ("Interbank", 9),
    ("Interfondos SAF", 9),
    ("Inversiones directas en empresas fuera de Peru", 6),
    ("Inversiones directas en empresas Peru", 5),
    ("Inversiones directas en propiedades fuera de peru", 9),
    ("Inversiones directas en propiedades Peru", 9),
    ("JPM", 10),
    ("Kallpa SAB", 7),
    ("LarrainVial SAB", 8),
    ("LPL", 10),
    ("Macrocapitales SAF", 7),
    ("Mapfre", 8),
    ("Medalist Partners", 9),
    ("Northern Trust", 10),
    ("Numa", 8),
    ("Pacifico Seguros", 6),
    ("PAHO", 7),
    ("Pershing", 10),
    ("Pichincha", 6),
    ("Prisma Inmobiliaria", 4),
    ("Produbanco", 7),
    ("Propio", 5),
    ("Propio / Exchange", 5),
    ("Prudential SAF", 7),
    ("S &T Comunicaciones Integral", 2),
    ("Sabadell", 9),
    ("Scotia Fondos SAF", 9),
    ("Scotia SAB", 9),
    ("Seminario SAB", 7),
    ("State Street", 10),
    ("Sura", 7),
    ("Sura SAB", 8),
    ("Sura SAF", 8),
    ("Tyba - Credicorp", 9),
    ("UBS", 10),
    ("Vanguard", 10),
    ("Zest Capital", 4),
]

MANAGERS: list[tuple[str, int]] = [
    ("Acciones directas", 10),
    ("Aegon Asset Management", 8),
    ("AFP Habitat", 8),
    ("Amara Foods EIRL", 2),
    ("American Ventures", 4),
    ("Apollo", 10),
    ("AQR", 10),
    ("Aurora Grupo Inmobiliario", 4),
    ("AXA Investment Managers", 9),
    ("Banco comercio", 5),
    ("Baring", 10),
    ("Barings", 10),
    ("BBVA SAF", 6),
    ("Blackrock", 10),
    ("Blackstone", 10),
    ("Blue Owl", 10),
    ("Blum SAF", 4),
    ("Bonos directos", 10),
    ("Brookfield", 10),
    ("BTG Pactual SAF", 5),
    ("Caja Arequipa", 8),
    ("Caja Huancayo", 5),
    ("Caja Piura", 6),
    ("Carlyle", 10),
    ("Cash o efectivo", 10),
    ("Celta Contratistas", 4),
    ("Cía. de Minas Buenaventura", 8),
    ("Citibank", 9),
    ("Cliffwater", 9),
    ("Compartamos", 8),
    ("Compass SAF", 6),
    ("Cooperativa Kori", 7),
    ("Core Capital", 5),
    ("Coril", 5),
    ("Credicorp Capital SAF", 6),
    ("Edifica", 8),
    ("Financiera Confianza", 3),
    ("Financiera Oh", 6),
    ("Financiera surgir", 6),
    ("Finsmart", 3),
    ("FLIP", 4),
    ("Global X", 8),
    ("GSA", 6),
    ("GSDynamic", 6),
    ("HPS", 9),
    ("iCapital", 8),
    ("Illusione", 6),
    ("Inteligo Bank", 8),
    ("Inteligo SAB", 9),
    ("Interactive Brokers", 9),
    ("Interbank", 9),
    ("Interfondos", 7),
    ("Interseguro", 8),
    ("Inversiones Directas", 10),
    ("Inversiones directas en empresas fuera de Peru", 5),
    ("Inversiones directas en empresas Peru", 4),
    ("Inversiones directas en propiedades fuera de peru", 9),
    ("Inversiones directas en propiedades Peru", 9),
    ("Invesco", 9),
    ("Janus Henderson", 9),
    ("JPMorgan", 8),
    ("KKR", 10),
    ("Mapfre", 7),
    ("Medalist", 9),
    ("Medalist Partners", 7),
    ("MFS", 10),
    ("Ninety One", 8),
    ("Nordea", 9),
    ("Numa", 8),
    ("Nvidia Corp", 8),
    ("Oaktree", 10),
    ("Pacifico Seguros", 6),
    ("Partners Group", 9),
    ("Pharmakon Advisors", 7),
    ("PIMCO", 10),
    ("Prisma Inmobiliaria", 4),
    ("Prologis / Palantir", 8),
    ("Prudential SAF", 5),
    ("S&T Comunicaciones Integral", 2),
    ("Sabadell", 8),
    ("Sabbi", 6),
    ("Schroders", 10),
    ("Scotia Fondos SAF", 6),
    ("SMART", 3),
    ("State Street Global", 9),
    ("Stepstone", 10),
    ("Sura SAF", 6),
    ("Tyba - Credicorp", 6),
    ("Vanguard", 10),
    ("Verition", 7),
    ("Xtrackers", 7),
    ("Zest Capital", 4),
]


def upgrade() -> None:
    op.create_table(
        "administrator",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text, nullable=False, unique=True),
        sa.Column("score", sa.Integer),
        sa.Column("score_is_fixed", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_table(
        "manager",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text, nullable=False, unique=True),
        sa.Column("score", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.add_column("product_catalog", sa.Column("administrator_score", sa.Integer))
    op.add_column("product_catalog", sa.Column("manager_score", sa.Integer))

    administrator_table = sa.table(
        "administrator",
        sa.column("name", sa.Text),
        sa.column("score", sa.Integer),
        sa.column("score_is_fixed", sa.Boolean),
    )
    op.bulk_insert(
        administrator_table,
        [
            {"name": name, "score": score, "score_is_fixed": name != "Cash o efectivo"}
            for name, score in ADMINISTRATORS
        ],
    )

    manager_table = sa.table(
        "manager",
        sa.column("name", sa.Text),
        sa.column("score", sa.Integer),
    )
    op.bulk_insert(
        manager_table,
        [{"name": name, "score": score} for name, score in MANAGERS],
    )


def downgrade() -> None:
    op.drop_column("product_catalog", "manager_score")
    op.drop_column("product_catalog", "administrator_score")
    op.drop_table("manager")
    op.drop_table("administrator")
