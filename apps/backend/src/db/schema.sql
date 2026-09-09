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
    underlying JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS asset_class TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS geographic_focus TEXT DEFAULT '';

-- Migration: geographic_focus TEXT -> JSONB
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='geographic_focus' AND data_type='text'
  ) THEN
    ALTER TABLE products ALTER COLUMN geographic_focus TYPE JSONB
      USING CASE WHEN geographic_focus IS NOT NULL AND geographic_focus != ''
        THEN jsonb_build_array(jsonb_build_object('name', geographic_focus, 'percentage', 100))
        ELSE '[]'::jsonb END;
    ALTER TABLE products ALTER COLUMN geographic_focus SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

ALTER TABLE products ADD COLUMN IF NOT EXISTS commission TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS administrator TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS manager TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS liquidity TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS return_rate TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_product_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS isin TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS distribution TEXT DEFAULT '';

-- Migration: normalize legacy category labels, backfill into asset_class,
-- then drop category (asset_class absorbs its role — same taxonomy values).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='category'
  ) THEN
    UPDATE products SET category = 'inversiones_directas' WHERE lower(category) IN ('real estate directo', 'inversiones directas', 'directas');
    UPDATE products SET category = 'mercados_privados' WHERE lower(category) IN ('mercados privados', 'mercados privado', 'privados');
    UPDATE products SET category = 'club_deals' WHERE lower(category) IN ('club deals', 'club');
    UPDATE products SET category = 'mercados_publicos' WHERE lower(category) IN ('mercados publicos', 'mercados públicos', 'publicos');
    UPDATE products SET category = 'cash_y_equivalentes' WHERE lower(category) IN ('cash y equivalentes', 'cash');
    UPDATE products SET asset_class = category WHERE asset_class IS NULL OR asset_class = '';
    ALTER TABLE products DROP COLUMN category;
  END IF;
END $$;
ALTER TABLE products ALTER COLUMN asset_class SET NOT NULL;

-- Migration: asset_class TEXT -> JSONB array
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='asset_class' AND data_type='text'
  ) THEN
    UPDATE products SET asset_class = CASE
      WHEN asset_class IS NOT NULL AND asset_class != ''
      THEN jsonb_build_array(jsonb_build_object('name', asset_class, 'percentage', 100))::text
      ELSE '[]' END;
    ALTER TABLE products ALTER COLUMN asset_class TYPE JSONB USING asset_class::jsonb;
    ALTER TABLE products ALTER COLUMN asset_class SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='product_catalog' AND column_name='category'
  ) THEN
    UPDATE product_catalog SET category = 'inversiones_directas' WHERE lower(category) IN ('real estate directo', 'inversiones directas', 'directas');
    UPDATE product_catalog SET category = 'mercados_privados' WHERE lower(category) IN ('mercados privados', 'mercados privado', 'privados');
    UPDATE product_catalog SET category = 'club_deals' WHERE lower(category) IN ('club deals', 'club');
    UPDATE product_catalog SET category = 'mercados_publicos' WHERE lower(category) IN ('mercados publicos', 'mercados públicos', 'publicos');
    UPDATE product_catalog SET category = 'cash_y_equivalentes' WHERE lower(category) IN ('cash y equivalentes', 'cash');
    UPDATE product_catalog SET asset_class = category WHERE asset_class IS NULL OR asset_class = '';
    ALTER TABLE product_catalog DROP COLUMN category;
  END IF;
END $$;

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
    geographic_focus JSONB DEFAULT '[]',
    asset_class JSONB DEFAULT '[]',
    underlying JSONB DEFAULT '[]',
    commission TEXT DEFAULT '',
    currency TEXT DEFAULT '',
    administrator TEXT DEFAULT '',
    manager TEXT DEFAULT '',
    liquidity TEXT DEFAULT '',
    return_rate TEXT DEFAULT '',
    isin TEXT DEFAULT '',
    distribution TEXT DEFAULT ''
);

-- Migration: product_catalog asset_class TEXT -> JSONB array
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='product_catalog' AND column_name='asset_class' AND data_type='text'
  ) THEN
    UPDATE product_catalog SET asset_class = CASE
      WHEN asset_class IS NOT NULL AND asset_class != ''
      THEN jsonb_build_array(jsonb_build_object('name', asset_class, 'percentage', 100))::text
      ELSE '[]' END;
    ALTER TABLE product_catalog ALTER COLUMN asset_class TYPE JSONB USING asset_class::jsonb;
    ALTER TABLE product_catalog ALTER COLUMN asset_class SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Migration: product_catalog geographic_focus TEXT -> JSONB
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='product_catalog' AND column_name='geographic_focus' AND data_type='text'
  ) THEN
    ALTER TABLE product_catalog ALTER COLUMN geographic_focus TYPE JSONB
      USING CASE WHEN geographic_focus IS NOT NULL AND geographic_focus != ''
        THEN jsonb_build_array(jsonb_build_object('name', geographic_focus, 'percentage', 100))
        ELSE '[]'::jsonb END;
    ALTER TABLE product_catalog ALTER COLUMN geographic_focus SET DEFAULT '[]'::jsonb;
  END IF;
END $$;
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS approved_from_product_id TEXT;
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS alternative_names TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_catalog_name_trgm
    ON product_catalog USING gin (name gin_trgm_ops);

-- Mirrors migrations/versions/a1b2c3d4e5f6_enable_search_extensions.py.
-- Needed here too: insert/update/replace on product_catalog now call
-- normalize_catalog_text() to compute `slugs`, not just the read-side
-- search in get_catalog().
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION normalize_catalog_text(input_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT lower(unaccent(input_text));
$$;

-- Mirrors migrations/versions/c3d4e5f6a1b2_add_slugs_to_product_catalog.py.
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS slugs TEXT[] DEFAULT '{}';

UPDATE product_catalog
SET slugs = (
    SELECT COALESCE(ARRAY_AGG(DISTINCT normalize_catalog_text(btrim(v))), '{}')
    FROM unnest(array_prepend(name, COALESCE(alternative_names, '{}'::text[]))) AS v
    WHERE v IS NOT NULL AND btrim(v) <> ''
)
WHERE slugs = '{}';

-- Mirrors migrations/versions/d4e5f6a1b2c3_add_administrator_manager_entities.py.
CREATE TABLE IF NOT EXISTS administrator (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    score INTEGER,
    score_is_fixed BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manager (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    score INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS administrator_score INTEGER;
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS manager_score INTEGER;
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS isin TEXT DEFAULT '';
ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS distribution TEXT DEFAULT '';

INSERT INTO administrator (name, score, score_is_fixed) VALUES
    ('ACRES Sociedad Titulizadora S.A', 5, true),
    ('AFP Habitat', 8, true),
    ('Amara Foods EIRL', 2, true),
    ('American Ventures', 5, true),
    ('Art Atlas S.R.L', 5, true),
    ('Aurora Grupo Inmobiliario', 4, true),
    ('Banco comercio', 5, true),
    ('Baring', 10, true),
    ('Barings', 10, true),
    ('BBVA SAB', 9, true),
    ('BBVA SAF', 9, true),
    ('BCP', 9, true),
    ('Blum SAF', 7, true),
    ('BNP Paribas', 10, true),
    ('BNY', 10, true),
    ('BTG Pactual SAB', 8, true),
    ('BTG Pactual SAF', 8, true),
    ('Caja Arequipa', 8, true),
    ('Caja Huancayo', 5, true),
    ('Caja Piura', 6, true),
    ('Cash o efectivo', NULL, false),
    ('Celta Contratistas', 4, true),
    ('Charles Schwab', 10, true),
    ('Citibank', 10, true),
    ('Compartamos', 8, true),
    ('Compass SAF', 8, true),
    ('Cooperativa Kori', 7, true),
    ('Core Capital', 6, true),
    ('Coril', 5, true),
    ('Coril SAF', 8, true),
    ('Credicorp Capital SAB', 9, true),
    ('Credicorp Capital SAF', 9, true),
    ('El Dorado SAF', 5, true),
    ('Faro Capital / Edifica', 8, true),
    ('Fidelity', 10, true),
    ('Financiera Oh', 6, true),
    ('Financiera surgir', 6, true),
    ('Flip', 4, true),
    ('GSDynamic', 6, true),
    ('HAPI', 6, true),
    ('HSBC', 10, true),
    ('Inteligo Bank', 8, true),
    ('Inteligo SAB', 9, true),
    ('Interactive Brokers', 9, true),
    ('Interbank', 9, true),
    ('Interfondos SAF', 9, true),
    ('Inversiones directas en empresas fuera de Peru', 6, true),
    ('Inversiones directas en empresas Peru', 5, true),
    ('Inversiones directas en propiedades fuera de peru', 9, true),
    ('Inversiones directas en propiedades Peru', 9, true),
    ('JPM', 10, true),
    ('Kallpa SAB', 7, true),
    ('LarrainVial SAB', 8, true),
    ('LPL', 10, true),
    ('Macrocapitales SAF', 7, true),
    ('Mapfre', 8, true),
    ('Medalist Partners', 9, true),
    ('Northern Trust', 10, true),
    ('Numa', 8, true),
    ('Pacifico Seguros', 6, true),
    ('PAHO', 7, true),
    ('Pershing', 10, true),
    ('Pichincha', 6, true),
    ('Prisma Inmobiliaria', 4, true),
    ('Produbanco', 7, true),
    ('Propio', 5, true),
    ('Propio / Exchange', 5, true),
    ('Prudential SAF', 7, true),
    ('S &T Comunicaciones Integral', 2, true),
    ('Sabadell', 9, true),
    ('Scotia Fondos SAF', 9, true),
    ('Scotia SAB', 9, true),
    ('Seminario SAB', 7, true),
    ('State Street', 10, true),
    ('Sura', 7, true),
    ('Sura SAB', 8, true),
    ('Sura SAF', 8, true),
    ('Tyba - Credicorp', 9, true),
    ('UBS', 10, true),
    ('Vanguard', 10, true),
    ('Zest Capital', 4, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO manager (name, score) VALUES
    ('Acciones directas', 10),
    ('Aegon Asset Management', 8),
    ('AFP Habitat', 8),
    ('Amara Foods EIRL', 2),
    ('American Ventures', 4),
    ('Apollo', 10),
    ('AQR', 10),
    ('Aurora Grupo Inmobiliario', 4),
    ('AXA Investment Managers', 9),
    ('Banco comercio', 5),
    ('Baring', 10),
    ('Barings', 10),
    ('BBVA SAF', 6),
    ('Blackrock', 10),
    ('Blackstone', 10),
    ('Blue Owl', 10),
    ('Blum SAF', 4),
    ('Bonos directos', 10),
    ('Brookfield', 10),
    ('BTG Pactual SAF', 5),
    ('Caja Arequipa', 8),
    ('Caja Huancayo', 5),
    ('Caja Piura', 6),
    ('Carlyle', 10),
    ('Cash o efectivo', 10),
    ('Celta Contratistas', 4),
    ('Cía. de Minas Buenaventura', 8),
    ('Citibank', 9),
    ('Cliffwater', 9),
    ('Compartamos', 8),
    ('Compass SAF', 6),
    ('Cooperativa Kori', 7),
    ('Core Capital', 5),
    ('Coril', 5),
    ('Credicorp Capital SAF', 6),
    ('Edifica', 8),
    ('Financiera Confianza', 3),
    ('Financiera Oh', 6),
    ('Financiera surgir', 6),
    ('Finsmart', 3),
    ('FLIP', 4),
    ('Global X', 8),
    ('GSA', 6),
    ('GSDynamic', 6),
    ('HPS', 9),
    ('iCapital', 8),
    ('Illusione', 6),
    ('Inteligo Bank', 8),
    ('Inteligo SAB', 9),
    ('Interactive Brokers', 9),
    ('Interbank', 9),
    ('Interfondos', 7),
    ('Interseguro', 8),
    ('Inversiones Directas', 10),
    ('Inversiones directas en empresas fuera de Peru', 5),
    ('Inversiones directas en empresas Peru', 4),
    ('Inversiones directas en propiedades fuera de peru', 9),
    ('Inversiones directas en propiedades Peru', 9),
    ('Invesco', 9),
    ('Janus Henderson', 9),
    ('JPMorgan', 8),
    ('KKR', 10),
    ('Mapfre', 7),
    ('Medalist', 9),
    ('Medalist Partners', 7),
    ('MFS', 10),
    ('Ninety One', 8),
    ('Nordea', 9),
    ('Numa', 8),
    ('Nvidia Corp', 8),
    ('Oaktree', 10),
    ('Pacifico Seguros', 6),
    ('Partners Group', 9),
    ('Pharmakon Advisors', 7),
    ('PIMCO', 10),
    ('Prisma Inmobiliaria', 4),
    ('Prologis / Palantir', 8),
    ('Prudential SAF', 5),
    ('S&T Comunicaciones Integral', 2),
    ('Sabadell', 8),
    ('Sabbi', 6),
    ('Schroders', 10),
    ('Scotia Fondos SAF', 6),
    ('SMART', 3),
    ('State Street Global', 9),
    ('Stepstone', 10),
    ('Sura SAF', 6),
    ('Tyba - Credicorp', 6),
    ('Vanguard', 10),
    ('Verition', 7),
    ('Xtrackers', 7),
    ('Zest Capital', 4)
ON CONFLICT (name) DO NOTHING;

-- Mirrors migrations/versions/e5f6a1b2c3d4_add_catalog_slugs_trgm_index.py.
-- array_to_string() is STABLE, not IMMUTABLE, so it can't be used directly
-- in an index expression (Postgres error 42P17) — wrap it the same way
-- normalize_catalog_text() wraps unaccent() above.
CREATE OR REPLACE FUNCTION catalog_slugs_text(input_slugs text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT array_to_string(input_slugs, ' ');
$$;

CREATE INDEX IF NOT EXISTS idx_catalog_slugs_trgm
    ON product_catalog USING gin (catalog_slugs_text(slugs) gin_trgm_ops);

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

-- Migration: rename category_summary -> asset_class_summary, rewrite JSONB keys
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='portfolio_snapshots' AND column_name='category_summary'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='portfolio_snapshots' AND column_name='asset_class_summary'
  ) THEN
    ALTER TABLE portfolio_snapshots RENAME COLUMN category_summary TO asset_class_summary;
    UPDATE portfolio_snapshots
    SET asset_class_summary = (
        SELECT jsonb_agg(
            jsonb_build_object('asset_class', elem->>'category', 'percentage', elem->'percentage')
        )
        FROM jsonb_array_elements(asset_class_summary) AS elem
    )
    WHERE asset_class_summary IS NOT NULL AND asset_class_summary != '[]'::jsonb;
  END IF;
END $$;

ALTER TABLE portfolio_snapshots ADD COLUMN IF NOT EXISTS asset_class_summary JSONB DEFAULT '[]';

DO $backfill$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='snapshot_products' AND column_name='product_data' AND data_type='jsonb'
  ) THEN
    EXECUTE $sql$
      UPDATE portfolio_snapshots ps
      SET asset_class_summary = COALESCE(agg.summary, '[]'::jsonb)
      FROM (
          SELECT
              sp.snapshot_id,
              jsonb_agg(
                  jsonb_build_object('asset_class', ac, 'percentage', round(ac_total / NULLIF(ps2.total_amount, 0) * 100, 1))
                  ORDER BY ac_total DESC
              ) AS summary
          FROM (
              SELECT snapshot_id,
                     COALESCE(product_data->>'asset_class', 'otros') AS ac,
                     SUM((product_data->>'amount')::numeric) AS ac_total
              FROM snapshot_products
              GROUP BY snapshot_id, ac
          ) sp
          JOIN portfolio_snapshots ps2 ON ps2.id = sp.snapshot_id
          GROUP BY sp.snapshot_id, ps2.total_amount
      ) agg
      WHERE agg.snapshot_id = ps.id
        AND (ps.asset_class_summary IS NULL OR ps.asset_class_summary = '[]'::jsonb)
    $sql$;
  END IF;
END $backfill$;

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

-- Migration: encrypt amount columns (NUMERIC -> TEXT)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='amount' AND data_type='numeric'
  ) THEN
    ALTER TABLE products ALTER COLUMN amount TYPE TEXT USING amount::text;
    ALTER TABLE products DROP CONSTRAINT IF EXISTS products_amount_positive;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='portfolio_snapshots' AND column_name='total_amount' AND data_type='numeric'
  ) THEN
    ALTER TABLE portfolio_snapshots ALTER COLUMN total_amount TYPE TEXT USING total_amount::text;
  END IF;
END $$;

-- Migration: encrypt JSONB blobs (JSONB -> TEXT)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='snapshot_products' AND column_name='product_data' AND data_type='jsonb'
  ) THEN
    ALTER TABLE snapshot_products ALTER COLUMN product_data TYPE TEXT USING product_data::text;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='portfolio_changes' AND column_name='before_state' AND data_type='jsonb'
  ) THEN
    ALTER TABLE portfolio_changes ALTER COLUMN before_state TYPE TEXT USING before_state::text;
    ALTER TABLE portfolio_changes ALTER COLUMN after_state TYPE TEXT USING after_state::text;
  END IF;
END $$;
