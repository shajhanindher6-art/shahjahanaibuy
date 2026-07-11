/*
# SmartBuy AI — Product Data Pipeline Tables (Phase 2)

## Overview
Creates the product data intelligence schema: retailers, products, product_images,
price_history, and product_sources. These tables store fetched product data from
external providers (official APIs + approved scraping), price history for tracking,
and source mappings for deduplication and provider management.

## 1. New Tables

### `retailers`
- Stores retailer/merchant information (Amazon, Daraz, eBay, etc.)
- `id` (uuid PK), `name`, `slug` (unique), `logo_url`, `website_url`, `active`, `country`
- `created_at`, `updated_at` (maintained via trigger)
- Pre-seeded with 4 major retailers

### `products`
- Central product catalog — normalized across all providers
- `id` (uuid PK), `name`, `slug` (unique), `description`, `brand`, `category`, `image_url`
- `gtin` (Global Trade Item Number — for deduplication across providers)
- `confidence_score` (0-100, data quality indicator)
- `data_freshness` (timestamptz — last time data was validated)
- `created_at`, `updated_at` (maintained via trigger)
- Indexed on `slug`, `gtin`, `category`, `brand`

### `product_images`
- Multiple images per product
- `id` (uuid PK), `product_id` (FK to products, ON DELETE CASCADE)
- `url`, `alt_text`, `is_primary`, `sort_order`
- Indexed on `product_id`

### `price_history`
- Time-series price data per product per retailer
- `id` (uuid PK), `product_id` (FK to products, ON DELETE CASCADE)
- `retailer_id` (FK to retailers, ON DELETE CASCADE)
- `price` (numeric, 2 decimal places), `currency`, `availability`, `url`
- `recorded_at` (timestamptz — when the price was observed)
- Indexed on `(product_id, recorded_at DESC)` and `(product_id, retailer_id, recorded_at DESC)`

### `product_sources`
- Maps products to external provider sources (for deduplication and re-fetching)
- `id` (uuid PK), `product_id` (FK to products, ON DELETE CASCADE)
- `retailer_id` (FK to retailers, ON DELETE CASCADE)
- `external_id` (provider's product ID), `provider_key` (which provider fetched it)
- `last_fetched_at` (timestamptz), `raw` (jsonb — original provider response)
- UNIQUE constraint on `(retailer_id, external_id)` — prevents duplicate sources
- Indexed on `product_id`, `provider_key`, `last_fetched_at`

## 2. Security (RLS)
- RLS enabled on ALL tables
- `retailers`: public read (anon + authenticated), no client write
- `products`: public read, no client write (managed by service layer/workers)
- `product_images`: public read, no client write
- `price_history`: public read, no client write
- `product_sources`: public read, no client write
- All writes go through the service role (server-side workers and API routes)

## 3. Triggers
- `update_retailers_updated_at()`: maintains `updated_at` on retailers
- `update_products_updated_at()`: maintains `updated_at` on products

## 4. Indexes
- `products_slug_idx` on `products(slug)` — frequent lookups
- `products_gtin_idx` on `products(gtin)` — deduplication
- `products_category_idx` on `products(category)` — category browsing
- `products_brand_idx` on `products(brand)` — brand filtering
- `product_images_product_idx` on `product_images(product_id)`
- `price_history_product_recorded_idx` on `price_history(product_id, recorded_at DESC)`
- `price_history_product_retailer_idx` on `price_history(product_id, retailer_id, recorded_at DESC)`
- `product_sources_product_idx` on `product_sources(product_id)`
- `product_sources_provider_idx` on `product_sources(provider_key)`
- `product_sources_last_fetched_idx` on `product_sources(last_fetched_at)`

## 5. Important Notes
1. Product writes are server-side only (service role) — RLS denies all client writes
2. `gtin` is the primary deduplication key across providers
3. `confidence_score` reflects data quality (completeness, freshness, source reliability)
4. `data_freshness` tracks when product data was last validated/refreshed
5. `price_history` is append-only — never updated or deleted
6. `product_sources.raw` stores the original provider response for debugging
7. Pre-seeded retailers are placeholders — real retailer config comes in Phase 3+
*/

-- ============================================================================
-- RETAILERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS retailers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  website_url text,
  active boolean NOT NULL DEFAULT true,
  country text NOT NULL DEFAULT 'US',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE retailers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retailers_select_all" ON retailers;
CREATE POLICY "retailers_select_all" ON retailers FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- PRODUCTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  brand text,
  category text,
  image_url text,
  gtin text,
  confidence_score integer NOT NULL DEFAULT 50,
  data_freshness timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_all" ON products;
CREATE POLICY "products_select_all" ON products FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS products_slug_idx ON products(slug);
CREATE INDEX IF NOT EXISTS products_gtin_idx ON products(gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand) WHERE brand IS NOT NULL;

-- ============================================================================
-- PRODUCT_IMAGES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt_text text,
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_images_select_all" ON product_images;
CREATE POLICY "product_images_select_all" ON product_images FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id);

-- ============================================================================
-- PRICE_HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retailer_id uuid NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  price numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  availability text NOT NULL DEFAULT 'in_stock',
  url text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_history_select_all" ON price_history;
CREATE POLICY "price_history_select_all" ON price_history FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS price_history_product_recorded_idx
  ON price_history(product_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS price_history_product_retailer_idx
  ON price_history(product_id, retailer_id, recorded_at DESC);

-- ============================================================================
-- PRODUCT_SOURCES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retailer_id uuid NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  provider_key text NOT NULL,
  last_fetched_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer_id, external_id)
);

ALTER TABLE product_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_sources_select_all" ON product_sources;
CREATE POLICY "product_sources_select_all" ON product_sources FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS product_sources_product_idx ON product_sources(product_id);
CREATE INDEX IF NOT EXISTS product_sources_provider_idx ON product_sources(provider_key);
CREATE INDEX IF NOT EXISTS product_sources_last_fetched_idx ON product_sources(last_fetched_at);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_retailers_updated_at ON retailers;
CREATE TRIGGER update_retailers_updated_at
  BEFORE UPDATE ON retailers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO retailers (name, slug, website_url, country) VALUES
  ('Amazon', 'amazon', 'https://www.amazon.com', 'US'),
  ('eBay', 'ebay', 'https://www.ebay.com', 'US'),
  ('Daraz', 'daraz', 'https://www.daraz.com', 'BD'),
  ('AliExpress', 'aliexpress', 'https://www.aliexpress.com', 'CN')
ON CONFLICT (slug) DO NOTHING;
