/*
# SmartBuy AI — Product Extension Tables (Phase 2 Upgrade, Migration 2)

## Overview
Extends the existing products table and creates product_variants, product_attributes,
and product_tags tables. Also links products to the new brands and categories tables.
Adds soft delete, refresh tracking, and structured variant support.

## 1. Schema Changes to `products`
- Add `brand_id` (FK to brands, nullable)
- Add `category_id` (FK to categories, nullable)
- Add `deleted_at` (soft delete timestamp)
- Add `refresh_priority` (1=critical, 2=high, 3=normal, 4=low, 5=dormant)
- Add `next_refresh_at` (when the product should next be refreshed)
- Add `refresh_status` (idle, queued, processing, failed)
- Add `view_count` (popularity signal for adaptive refresh)

## 2. New Tables

### `product_variants`
- Product variant entries (size, color, storage, etc.)
- `id` (uuid PK), `product_id` (FK, CASCADE), `name`, `sku`
- `attributes` (jsonb — {color: 'red', size: 'XL'}), `image_url`
- `in_stock`, `sort_order`, `active`
- `created_at`, `updated_at`, `deleted_at` (soft delete)
- Indexed on `product_id`, partial index on active non-deleted variants

### `product_attributes`
- EAV-style structured attributes for flexible product specs
- `id` (uuid PK), `product_id` (FK, CASCADE), `key`, `value`, `unit`
- `group` (grouping label e.g. 'Dimensions', 'Technical Specs')
- `sort_order`, `created_at`
- UNIQUE on `(product_id, key)`

### `product_tags`
- Many-to-many join table: products ↔ tags
- `product_id` (FK), `tag_id` (FK)
- PRIMARY KEY `(product_id, tag_id)`

## 3. Indexes
- `products_brand_idx` on `products(brand_id)`
- `products_category_idx` on `products(category_id)`
- `products_refresh_idx` on `products(next_refresh_at, refresh_priority)` WHERE not deleted
- `products_deleted_idx` partial index WHERE deleted_at IS NOT NULL
- `product_variants_product_idx` on `product_variants(product_id)`
- `product_attributes_product_key_idx` UNIQUE on `product_attributes(product_id, key)`

## 4. Security (RLS)
- `product_variants`: public read, no client write
- `product_attributes`: public read, no client write
- `product_tags`: public read, no client write

## 5. Important Notes
1. Existing products columns and data are NOT modified — only new columns added
2. `refresh_priority` drives the adaptive refresh scheduling system
3. `view_count` is incremented on each product detail view for popularity scoring
4. Soft-deleted products (deleted_at IS NOT NULL) are excluded from public queries
5. Product variants support jsonb `attributes` for flexible spec storage
*/

-- ============================================================================
-- EXTEND PRODUCTS TABLE
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'brand_id') THEN
    ALTER TABLE products ADD COLUMN brand_id uuid REFERENCES brands(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'category_id') THEN
    ALTER TABLE products ADD COLUMN category_id uuid REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'deleted_at') THEN
    ALTER TABLE products ADD COLUMN deleted_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'refresh_priority') THEN
    ALTER TABLE products ADD COLUMN refresh_priority integer NOT NULL DEFAULT 3;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'next_refresh_at') THEN
    ALTER TABLE products ADD COLUMN next_refresh_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'refresh_status') THEN
    ALTER TABLE products ADD COLUMN refresh_status text NOT NULL DEFAULT 'idle';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'view_count') THEN
    ALTER TABLE products ADD COLUMN view_count integer NOT NULL DEFAULT 0;
  END IF;
END $$;

-- New indexes for extended products columns
CREATE INDEX IF NOT EXISTS products_brand_idx ON products(brand_id) WHERE brand_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_refresh_idx ON products(next_refresh_at, refresh_priority) WHERE deleted_at IS NULL;

-- ============================================================================
-- PRODUCT_VARIANTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_url text,
  in_stock boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_variants_select_all" ON product_variants;
CREATE POLICY "product_variants_select_all" ON product_variants FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS product_variants_product_idx ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS product_variants_active_idx ON product_variants(product_id, sort_order)
  WHERE active = true AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS update_product_variants_updated_at ON product_variants;
CREATE TRIGGER update_product_variants_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- PRODUCT_ATTRIBUTES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  unit text,
  "group" text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, key)
);

ALTER TABLE product_attributes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_attributes_select_all" ON product_attributes;
CREATE POLICY "product_attributes_select_all" ON product_attributes FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS product_attributes_product_idx ON product_attributes(product_id);

-- ============================================================================
-- PRODUCT_TAGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_tags (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, tag_id)
);

ALTER TABLE product_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_tags_select_all" ON product_tags;
CREATE POLICY "product_tags_select_all" ON product_tags FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS product_tags_tag_idx ON product_tags(tag_id);
