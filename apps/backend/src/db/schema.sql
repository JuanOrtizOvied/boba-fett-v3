CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    active_thread_id TEXT
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_thread_id TEXT;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    provider TEXT DEFAULT '',
    amount NUMERIC NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    composition JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS asset_class TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS geographic_focus TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS underlying TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS commission TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS administrator TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS manager TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidity TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS return_rate TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_products_user ON products (user_id);

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
    return_rate TEXT DEFAULT '',
    category TEXT DEFAULT '',
    subcategory TEXT DEFAULT ''
);

ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS subcategory TEXT DEFAULT '';
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS approved_from_product_id TEXT;
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_catalog_name_trgm
    ON product_catalog USING gin (name gin_trgm_ops);
