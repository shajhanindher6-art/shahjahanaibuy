/*
# SmartBuy AI — Merchant & Commerce Tables (Phase 2 Upgrade, Migration 3)

## Overview
Creates the commerce layer: merchants, merchant_products, data_sources, deals,
coupons, and cashback_offers. These tables power the merchant ecosystem, deal
tracking, and promotional offer management.

## 1. New Tables

### `merchants`
- Registered merchants/retailers with account-level metadata
- `id` (uuid PK), `name`, `slug` (unique), `logo_url`, `website_url`
- `country_id` (FK), `currency_id` (FK), `contact_email`, `phone`
- `status` (pending, active, suspended, deactivated)
- `commission_rate` (percentage), `active`, `created_at`, `updated_at`, `deleted_at`
- Indexed on `slug`

### `merchant_products`
- Links products to merchants with merchant-specific pricing and availability
- `id` (uuid PK), `product_id` (FK), `merchant_id` (FK)
- `merchant_sku`, `price`, `compare_at_price` (original price for discount display)
- `currency_id` (FK), `availability`, `url`, `shipping_cost`, `shipping_days`
- `in_stock`, `stock_quantity`, `last_synced_at`
- `created_at`, `updated_at`, `deleted_at`
- UNIQUE on `(merchant_id, product_id)` — one listing per merchant per product
- Indexed on `product_id`, `merchant_id`

### `data_sources`
- Configured data source feeds (API endpoints, CSV URLs, affiliate feeds)
- `id` (uuid PK), `provider_id` (FK to providers), `merchant_id` (FK, nullable)
- `name`, `source_type` (api, csv, affiliate_feed, manual_upload)
- `source_url`, `schedule_cron` (cron expression for scheduled syncs)
- `last_sync_at`, `last_sync_status`, `last_sync_error`
- `total_records_synced`, `active`, `created_at`, `updated_at`
- Indexed on `provider_id`, `merchant_id`

### `deals`
- Time-limited promotional deals on products
- `id` (uuid PK), `product_id` (FK), `merchant_id` (FK, nullable)
- `title`, `description`, `deal_type` (flash_sale, clearance, seasonal, bundle)
- `discount_type` (percentage, fixed_amount), `discount_value`
- `start_at`, `end_at`, `coupon_code` (nullable), `url`
- `active`, `created_at`, `updated_at`, `deleted_at`
- Indexed on `(active, end_at)` for finding active deals

### `coupons`
- Coupon codes for discounts at checkout
- `id` (uuid PK), `code` (unique), `merchant_id` (FK, nullable)
- `description`, `discount_type`, `discount_value`
- `min_order_value`, `max_discount_amount`
- `usage_limit`, `usage_count`, `per_user_limit`
- `valid_from`, `valid_until`, `active`, `created_at`, `updated_at`
- Indexed on `code`

### `cashback_offers`
- Cashback programs from merchants or affiliate networks
- `id` (uuid PK), `merchant_id` (FK), `product_id` (FK, nullable)
- `title`, `description`, `cashback_type` (percentage, fixed)
- `cashback_value`, `max_cashback_amount`
- `start_at`, `end_at`, `terms_url`, `active`
- `created_at`, `updated_at`, `deleted_at`
- Indexed on `(active, end_at)`

## 2. Security (RLS)
- All tables: public read (anon + authenticated), no client write
- `merchant_products`, `deals`, `coupons`, `cashback_offers` — public read for active records

## 3. Triggers
- `update_merchants_updated_at()`, `update_merchant_products_updated_at()`
- `update_data_sources_updated_at()`, `update_deals_updated_at()`
- `update_coupons_updated_at()`, `update_cashback_offers_updated_at()`

## 4. Important Notes
1. `merchants` extends the existing `retailers` table concept with account-level data
2. `merchant_products` stores merchant-specific pricing separate from `price_history`
3. `data_sources` supports scheduled syncs via cron expressions
4. `deals` and `coupons` are separate: deals are product-level promotions, coupons are code-based
5. All commerce tables support soft deletes
*/

-- ============================================================================
-- MERCHANTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  website_url text,
  country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
  currency_id uuid REFERENCES currencies(id) ON DELETE SET NULL,
  contact_email text,
  phone text,
  status text NOT NULL DEFAULT 'pending',
  commission_rate numeric(5, 2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "merchants_select_all" ON merchants;
CREATE POLICY "merchants_select_all" ON merchants FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS merchants_slug_idx ON merchants(slug);

DROP TRIGGER IF EXISTS update_merchants_updated_at ON merchants;
CREATE TRIGGER update_merchants_updated_at
  BEFORE UPDATE ON merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- MERCHANT_PRODUCTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS merchant_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  merchant_sku text,
  price numeric(12, 2) NOT NULL,
  compare_at_price numeric(12, 2),
  currency_id uuid REFERENCES currencies(id) ON DELETE SET NULL,
  availability text NOT NULL DEFAULT 'in_stock',
  url text,
  shipping_cost numeric(12, 2),
  shipping_days integer,
  in_stock boolean NOT NULL DEFAULT true,
  stock_quantity integer,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (merchant_id, product_id)
);

ALTER TABLE merchant_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "merchant_products_select_all" ON merchant_products;
CREATE POLICY "merchant_products_select_all" ON merchant_products FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS merchant_products_product_idx ON merchant_products(product_id);
CREATE INDEX IF NOT EXISTS merchant_products_merchant_idx ON merchant_products(merchant_id);

DROP TRIGGER IF EXISTS update_merchant_products_updated_at ON merchant_products;
CREATE TRIGGER update_merchant_products_updated_at
  BEFORE UPDATE ON merchant_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- DATA_SOURCES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL,
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'api',
  source_url text,
  schedule_cron text,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  total_records_synced integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "data_sources_select_all" ON data_sources;
CREATE POLICY "data_sources_select_all" ON data_sources FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS data_sources_provider_idx ON data_sources(provider_id);
CREATE INDEX IF NOT EXISTS data_sources_merchant_idx ON data_sources(merchant_id);

DROP TRIGGER IF EXISTS update_data_sources_updated_at ON data_sources;
CREATE TRIGGER update_data_sources_updated_at
  BEFORE UPDATE ON data_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- DEALS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  deal_type text NOT NULL DEFAULT 'seasonal',
  discount_type text NOT NULL DEFAULT 'percentage',
  discount_value numeric(12, 2) NOT NULL,
  start_at timestamptz NOT NULL DEFAULT now(),
  end_at timestamptz NOT NULL,
  coupon_code text,
  url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deals_select_all" ON deals;
CREATE POLICY "deals_select_all" ON deals FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS deals_active_end_idx ON deals(active, end_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS deals_product_idx ON deals(product_id);

DROP TRIGGER IF EXISTS update_deals_updated_at ON deals;
CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- COUPONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL,
  description text,
  discount_type text NOT NULL DEFAULT 'percentage',
  discount_value numeric(12, 2) NOT NULL,
  min_order_value numeric(12, 2),
  max_discount_amount numeric(12, 2),
  usage_limit integer,
  usage_count integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coupons_select_all" ON coupons;
CREATE POLICY "coupons_select_all" ON coupons FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS coupons_code_idx ON coupons(code);

DROP TRIGGER IF EXISTS update_coupons_updated_at ON coupons;
CREATE TRIGGER update_coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- CASHBACK_OFFERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS cashback_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  cashback_type text NOT NULL DEFAULT 'percentage',
  cashback_value numeric(12, 2) NOT NULL,
  max_cashback_amount numeric(12, 2),
  start_at timestamptz NOT NULL DEFAULT now(),
  end_at timestamptz NOT NULL,
  terms_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE cashback_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cashback_offers_select_all" ON cashback_offers;
CREATE POLICY "cashback_offers_select_all" ON cashback_offers FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS cashback_active_end_idx ON cashback_offers(active, end_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cashback_merchant_idx ON cashback_offers(merchant_id);

DROP TRIGGER IF EXISTS update_cashback_offers_updated_at ON cashback_offers;
CREATE TRIGGER update_cashback_offers_updated_at
  BEFORE UPDATE ON cashback_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
