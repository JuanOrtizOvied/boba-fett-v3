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
    underlying JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS asset_class TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS geographic_focus TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS commission TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS administrator TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS manager TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidity TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS return_rate TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_product_id INTEGER;

UPDATE products SET category = 'inversiones_directas' WHERE lower(category) IN ('real estate directo', 'inversiones directas', 'directas');
UPDATE products SET category = 'mercados_privados' WHERE lower(category) IN ('mercados privados', 'mercados privado', 'privados');
UPDATE products SET category = 'club_deals' WHERE lower(category) IN ('club deals', 'club');
UPDATE products SET category = 'mercados_publicos' WHERE lower(category) IN ('mercados publicos', 'mercados públicos', 'publicos');
UPDATE products SET category = 'cash_y_equivalentes' WHERE lower(category) IN ('cash y equivalentes', 'cash');

UPDATE product_catalog SET category = 'inversiones_directas' WHERE lower(category) IN ('real estate directo', 'inversiones directas', 'directas');
UPDATE product_catalog SET category = 'mercados_privados' WHERE lower(category) IN ('mercados privados', 'mercados privado', 'privados');
UPDATE product_catalog SET category = 'club_deals' WHERE lower(category) IN ('club deals', 'club');
UPDATE product_catalog SET category = 'mercados_publicos' WHERE lower(category) IN ('mercados publicos', 'mercados públicos', 'publicos');
UPDATE product_catalog SET category = 'cash_y_equivalentes' WHERE lower(category) IN ('cash y equivalentes', 'cash');

-- Migration: remove subcategory, merge composition into underlying
ALTER TABLE products DROP COLUMN IF EXISTS subcategory;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='composition') THEN
    ALTER TABLE products DROP COLUMN IF EXISTS underlying;
    ALTER TABLE products RENAME COLUMN composition TO underlying;
  END IF;
END $$;

ALTER TABLE product_catalog DROP COLUMN IF EXISTS subcategory;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='product_catalog' AND column_name='underlying' AND data_type='text'
  ) THEN
    ALTER TABLE product_catalog DROP COLUMN underlying;
    ALTER TABLE product_catalog ADD COLUMN underlying JSONB DEFAULT '[]';
  END IF;
END $$;

-- Backfill: copy underlying from source products into catalog entries that have none
UPDATE product_catalog pc
SET underlying = p.underlying
FROM products p
WHERE pc.approved_from_product_id = p.id
  AND (pc.underlying IS NULL OR pc.underlying = '[]'::jsonb)
  AND p.underlying IS NOT NULL
  AND p.underlying != '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_products_user ON products (user_id);
CREATE INDEX IF NOT EXISTS idx_products_catalog_product_id ON products (catalog_product_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS product_catalog (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    geographic_focus TEXT DEFAULT '',
    asset_class TEXT DEFAULT '',
    underlying JSONB DEFAULT '[]',
    commission TEXT DEFAULT '',
    currency TEXT DEFAULT '',
    administrator TEXT DEFAULT '',
    manager TEXT DEFAULT '',
    liquidity TEXT DEFAULT '',
    return_rate TEXT DEFAULT '',
    category TEXT DEFAULT ''
);

ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS approved_from_product_id TEXT;
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS alternative_names TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_catalog_name_trgm
    ON product_catalog USING gin (name gin_trgm_ops);

-- Portfolio Versioning: Snapshots
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    product_count INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS category_summary JSONB DEFAULT '[]';

UPDATE portfolio_snapshots ps
SET category_summary = COALESCE(agg.summary, '[]'::jsonb)
FROM (
    SELECT
        sp.snapshot_id,
        jsonb_agg(
            jsonb_build_object('category', cat, 'percentage', round(cat_total / NULLIF(ps2.total_amount, 0) * 100, 1))
            ORDER BY cat_total DESC
        ) AS summary
    FROM (
        SELECT snapshot_id,
               COALESCE(product_data->>'category', 'otros') AS cat,
               SUM((product_data->>'amount')::numeric) AS cat_total
        FROM snapshot_products
        GROUP BY snapshot_id, cat
    ) sp
    JOIN portfolio_snapshots ps2 ON ps2.id = sp.snapshot_id
    GROUP BY sp.snapshot_id, ps2.total_amount
) agg
WHERE agg.snapshot_id = ps.id
  AND (ps.category_summary IS NULL OR ps.category_summary = '[]'::jsonb);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_created
    ON portfolio_snapshots (user_id, created_at DESC);

-- Portfolio Versioning: Snapshot Products (materialized state)
CREATE TABLE IF NOT EXISTS snapshot_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_products_snapshot
    ON snapshot_products (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_snapshot_products_product_id
    ON snapshot_products (product_id);

-- Portfolio Versioning: Change Log (audit trail)
CREATE TABLE IF NOT EXISTS portfolio_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    before_state JSONB,
    after_state JSONB,
    source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('agent', 'api', 'admin')),
    snapshot_id UUID REFERENCES portfolio_snapshots(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changes_user_created
    ON portfolio_changes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_changes_product
    ON portfolio_changes (product_id);

CREATE INDEX IF NOT EXISTS idx_changes_snapshot
    ON portfolio_changes (snapshot_id)
    WHERE snapshot_id IS NOT NULL;
