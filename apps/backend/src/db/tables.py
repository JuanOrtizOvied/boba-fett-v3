"""SQLAlchemy table definitions — single source of truth for the DB schema.

These are Core `Table` objects (not ORM-mapped classes) used exclusively by
Alembic for migration autogeneration.  All runtime queries still use raw
asyncpg — this module is never imported at request time.
"""

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    Table,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")),
    Column("email", Text, unique=True, nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("role", Text, nullable=False, server_default="user"),
    Column("created_by", UUID(as_uuid=True), ForeignKey("users.id")),
    Column("created_at", DateTime(timezone=True), server_default=text("now()")),
    Column("updated_at", DateTime(timezone=True), server_default=text("now()")),
    Column("active_thread_id", Text),
    CheckConstraint("role IN ('user', 'admin')", name="users_role_check"),
)

refresh_tokens = Table(
    "refresh_tokens",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")),
    Column(
        "user_id", UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    ),
    Column("token_hash", Text, unique=True, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("created_at", DateTime(timezone=True), server_default=text("now()")),
    Index("idx_refresh_tokens_user", "user_id"),
)

products = Table(
    "products",
    metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id"), nullable=False),
    Column("name", Text, nullable=False),
    Column("provider", Text, server_default=""),
    Column("amount", Numeric, nullable=False),
    Column("category", Text, nullable=False),
    Column("underlying", JSONB, server_default=text("'[]'::jsonb")),
    Column("created_at", DateTime(timezone=True), server_default=text("now()")),
    Column("updated_at", DateTime(timezone=True), server_default=text("now()")),
    Column("asset_class", Text, server_default=""),
    Column("geographic_focus", Text, server_default=""),
    Column("commission", Text, server_default=""),
    Column("currency", Text, server_default=""),
    Column("administrator", Text, server_default=""),
    Column("manager", Text, server_default=""),
    Column("liquidity", Text, server_default=""),
    Column("return_rate", Text, server_default=""),
    Column("catalog_product_id", Integer),
    CheckConstraint("amount > 0", name="products_amount_positive"),
    Index("idx_products_user", "user_id"),
    Index("idx_products_catalog_product_id", "catalog_product_id"),
)

product_catalog = Table(
    "product_catalog",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("geographic_focus", Text, server_default=""),
    Column("asset_class", Text, server_default=""),
    Column("underlying", JSONB, server_default=text("'[]'::jsonb")),
    Column("commission", Text, server_default=""),
    Column("currency", Text, server_default=""),
    Column("administrator", Text, server_default=""),
    Column("manager", Text, server_default=""),
    Column("liquidity", Text, server_default=""),
    Column("return_rate", Text, server_default=""),
    Column("category", Text, server_default=""),
    Column("approved_from_product_id", Text),
    Column("approved_at", DateTime(timezone=True)),
    Column("alternative_names", ARRAY(Text), server_default=text("'{}'::text[]")),
)

portfolio_snapshots = Table(
    "portfolio_snapshots",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")),
    Column(
        "user_id", UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    ),
    Column("name", Text, nullable=False),
    Column("description", Text, nullable=False, server_default=""),
    Column("product_count", Integer, nullable=False, server_default=text("0")),
    Column("total_amount", Numeric, nullable=False, server_default=text("0")),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=text("now()")),
    Column("category_summary", JSONB, server_default=text("'[]'::jsonb")),
)

snapshot_products = Table(
    "snapshot_products",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")),
    Column(
        "snapshot_id", UUID(as_uuid=True),
        ForeignKey("portfolio_snapshots.id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("product_id", Text, nullable=False),
    Column("product_data", JSONB, nullable=False),
    Index("idx_snapshot_products_snapshot", "snapshot_id"),
    Index("idx_snapshot_products_product_id", "product_id"),
)

portfolio_changes = Table(
    "portfolio_changes",
    metadata,
    Column("id", UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")),
    Column(
        "user_id", UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    ),
    Column("product_id", Text),
    Column("operation", Text, nullable=False),
    Column("before_state", JSONB),
    Column("after_state", JSONB),
    Column("source", Text, nullable=False, server_default="api"),
    Column(
        "snapshot_id", UUID(as_uuid=True),
        ForeignKey("portfolio_snapshots.id", ondelete="SET NULL"),
    ),
    Column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=text("now()")),
    CheckConstraint("operation IN ('create', 'update', 'delete')", name="changes_operation_check"),
    CheckConstraint("source IN ('agent', 'api', 'admin')", name="changes_source_check"),
)

# -- Indexes that need special syntax (DESC, WHERE, GIN) -------------------

Index(
    "idx_catalog_name_trgm",
    product_catalog.c.name,
    postgresql_using="gin",
    postgresql_ops={"name": "gin_trgm_ops"},
)

Index(
    "idx_snapshots_user_created",
    portfolio_snapshots.c.user_id,
    portfolio_snapshots.c.created_at.desc(),
)

Index(
    "idx_changes_user_created",
    portfolio_changes.c.user_id,
    portfolio_changes.c.created_at.desc(),
)
Index("idx_changes_product", portfolio_changes.c.product_id)
Index(
    "idx_changes_snapshot",
    portfolio_changes.c.snapshot_id,
    postgresql_where=portfolio_changes.c.snapshot_id.is_not(None),
)
