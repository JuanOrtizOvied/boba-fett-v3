CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    portfolio_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider TEXT DEFAULT '',
    amount NUMERIC NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    composition JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_portfolio ON products (portfolio_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS product_catalog (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    geographic_focus TEXT DEFAULT '',
    asset_class TEXT DEFAULT '',
    underlying TEXT DEFAULT '',
    commission TEXT DEFAULT '',
    currency TEXT DEFAULT '',
    administrator TEXT DEFAULT '',
    manager TEXT DEFAULT '',
    liquidity TEXT DEFAULT '',
    return_rate TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_catalog_name_trgm
    ON product_catalog USING gin (name gin_trgm_ops);
