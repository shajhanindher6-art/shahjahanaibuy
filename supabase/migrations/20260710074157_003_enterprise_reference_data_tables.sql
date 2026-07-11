/*
# SmartBuy AI — Enterprise Reference Data Tables (Phase 2 Upgrade, Migration 1)

## Overview
Creates the foundational reference data tables that the entire platform depends on:
currencies, countries, regions, languages, providers, brands, categories, and tags.
These tables are pre-seeded with common values and serve as the backbone for
internationalization, provider management, and product classification.

## 1. New Tables

### `currencies`
- ISO 4217 currency codes and metadata
- `id` (uuid PK), `code` (unique, 3-letter ISO), `name`, `symbol`, `decimal_places`
- `active`, `created_at`
- Pre-seeded with USD, EUR, GBP, JPY, CAD, AUD, BDT, CNY, INR, PKR

### `countries`
- ISO 3166-1 country codes and metadata
- `id` (uuid PK), `code` (unique, 2-letter ISO), `name`, `currency_id` (FK)
- `active`, `created_at`
- Pre-seeded with US, GB, DE, FR, JP, CA, AU, BD, CN, IN, PK

### `regions`
- Sub-country regions/states/provinces
- `id` (uuid PK), `country_id` (FK), `name`, `code`
- `created_at`
- UNIQUE on `(country_id, code)`

### `languages`
- ISO 639-1 language codes
- `id` (uuid PK), `code` (unique, 2-letter), `name`, `native_name`
- `active`, `created_at`
- Pre-seeded with en, es, fr, de, ja, zh, bn, hi, ar, pt

### `providers`
- External data provider registry (official APIs, affiliate feeds, scraping, etc.)
- `id` (uuid PK), `key` (unique), `name`, `type` (enum-like text)
- `base_url`, `api_key_env` (env var name, NOT the actual key), `active`
- `rate_limit_per_minute`, `priority` (lower = preferred)
- `created_at`, `updated_at`
- Pre-seeded with mock, apify, amazon_api, ebay_api

### `brands`
- Product brand catalog
- `id` (uuid PK), `name` (unique), `slug` (unique), `logo_url`, `description`
- `country_id` (FK, nullable), `active`, `created_at`, `updated_at`
- `deleted_at` (soft delete)
- Indexed on `slug`

### `categories`
- Hierarchical product categories (self-referencing tree)
- `id` (uuid PK), `name`, `slug` (unique), `parent_id` (self FK, nullable)
- `description`, `icon`, `sort_order`, `active`
- `created_at`, `updated_at`, `deleted_at` (soft delete)
- Indexed on `slug`, `parent_id`

### `tags`
- Flexible tagging system for products
- `id` (uuid PK), `name` (unique), `slug` (unique), `description`
- `created_at`
- Pre-seeded with common shopping tags

## 2. Security (RLS)
- All tables: public read (anon + authenticated), no client write
- All writes via service role (server-side workers and admin)

## 3. Triggers
- `update_brands_updated_at()`: maintains `updated_at` on brands
- `update_categories_updated_at()`: maintains `updated_at` on categories
- `update_providers_updated_at()`: maintains `updated_at` on providers

## 4. Indexes
- `brands_slug_idx` on `brands(slug)`
- `categories_slug_idx` on `categories(slug)`
- `categories_parent_idx` on `categories(parent_id)`
- `providers_key_idx` on `providers(key)`

## 5. Important Notes
1. `providers.api_key_env` stores the NAME of the environment variable, never the key itself
2. Brands and categories support soft deletes (`deleted_at`)
3. Categories are self-referencing (parent_id) for hierarchical taxonomy
4. All reference tables are pre-seeded with common values
5. `provider.priority` determines provider selection order (1 = highest priority)
*/

-- ============================================================================
-- CURRENCIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS currencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  symbol text,
  decimal_places integer NOT NULL DEFAULT 2,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "currencies_select_all" ON currencies;
CREATE POLICY "currencies_select_all" ON currencies FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- COUNTRIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  currency_id uuid REFERENCES currencies(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "countries_select_all" ON countries;
CREATE POLICY "countries_select_all" ON countries FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- REGIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country_id, code)
);

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "regions_select_all" ON regions;
CREATE POLICY "regions_select_all" ON regions FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- LANGUAGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  native_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE languages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "languages_select_all" ON languages;
CREATE POLICY "languages_select_all" ON languages FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- PROVIDERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'official_api',
  base_url text,
  api_key_env text,
  active boolean NOT NULL DEFAULT true,
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  priority integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "providers_select_all" ON providers;
CREATE POLICY "providers_select_all" ON providers FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS providers_key_idx ON providers(key);

-- ============================================================================
-- BRANDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  description text,
  country_id uuid REFERENCES countries(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brands_select_all" ON brands;
CREATE POLICY "brands_select_all" ON brands FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS brands_slug_idx ON brands(slug);

-- ============================================================================
-- CATEGORIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  parent_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  description text,
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categories_select_all" ON categories;
CREATE POLICY "categories_select_all" ON categories FOR SELECT
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS categories_slug_idx ON categories(slug);
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories(parent_id);

-- ============================================================================
-- TAGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tags_select_all" ON tags;
CREATE POLICY "tags_select_all" ON tags FOR SELECT
  TO anon, authenticated USING (true);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_brands_updated_at ON brands;
CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_categories_updated_at ON categories;
CREATE TRIGGER update_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_providers_updated_at ON providers;
CREATE TRIGGER update_providers_updated_at
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Currencies
INSERT INTO currencies (code, name, symbol, decimal_places) VALUES
  ('USD', 'US Dollar', '$', 2),
  ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2),
  ('JPY', 'Japanese Yen', '¥', 0),
  ('CAD', 'Canadian Dollar', 'C$', 2),
  ('AUD', 'Australian Dollar', 'A$', 2),
  ('BDT', 'Bangladeshi Taka', '৳', 2),
  ('CNY', 'Chinese Yuan', '¥', 2),
  ('INR', 'Indian Rupee', '₹', 2),
  ('PKR', 'Pakistani Rupee', '₨', 2)
ON CONFLICT (code) DO NOTHING;

-- Countries (link currency by code lookup)
INSERT INTO countries (code, name, currency_id)
SELECT c.code, c.name, cur.id FROM (VALUES
  ('US', 'United States', 'USD'),
  ('GB', 'United Kingdom', 'GBP'),
  ('DE', 'Germany', 'EUR'),
  ('FR', 'France', 'EUR'),
  ('JP', 'Japan', 'JPY'),
  ('CA', 'Canada', 'CAD'),
  ('AU', 'Australia', 'AUD'),
  ('BD', 'Bangladesh', 'BDT'),
  ('CN', 'China', 'CNY'),
  ('IN', 'India', 'INR'),
  ('PK', 'Pakistan', 'PKR')
) AS c(code, name, currency_code)
JOIN currencies cur ON cur.code = c.currency_code
ON CONFLICT (code) DO NOTHING;

-- Languages
INSERT INTO languages (code, name, native_name) VALUES
  ('en', 'English', 'English'),
  ('es', 'Spanish', 'Español'),
  ('fr', 'French', 'Français'),
  ('de', 'German', 'Deutsch'),
  ('ja', 'Japanese', '日本語'),
  ('zh', 'Chinese', '中文'),
  ('bn', 'Bengali', 'বাংলা'),
  ('hi', 'Hindi', 'हिन्दी'),
  ('ar', 'Arabic', 'العربية'),
  ('pt', 'Portuguese', 'Português')
ON CONFLICT (code) DO NOTHING;

-- Providers
INSERT INTO providers (key, name, type, base_url, api_key_env, active, rate_limit_per_minute, priority) VALUES
  ('mock', 'Mock Provider', 'mock', NULL, NULL, true, 9999, 99),
  ('apify', 'Apify', 'scraping', 'https://api.apify.com/v2', 'APIFY_API_TOKEN', false, 30, 20),
  ('amazon_api', 'Amazon Product API', 'official_api', 'https://webservices.amazon.com', 'AMAZON_API_KEY', false, 60, 5),
  ('ebay_api', 'eBay Browse API', 'official_api', 'https://api.ebay.com', 'EBAY_API_KEY', false, 60, 6),
  ('affiliate_feed', 'Affiliate Feed', 'affiliate_feed', NULL, 'AFFILIATE_FEED_KEY', false, 100, 10),
  ('merchant_upload', 'Merchant Upload', 'merchant_upload', NULL, NULL, false, 9999, 15),
  ('csv_import', 'CSV Import', 'csv_import', NULL, NULL, false, 9999, 50)
ON CONFLICT (key) DO NOTHING;

-- Tags
INSERT INTO tags (name, slug, description) VALUES
  ('Best Seller', 'best-seller', 'Top selling products'),
  ('Trending', 'trending', 'Currently trending products'),
  ('New Arrival', 'new-arrival', 'Recently added products'),
  ('Deal', 'deal', 'Products with active deals'),
  ('Eco-Friendly', 'eco-friendly', 'Environmentally friendly products'),
  ('Premium', 'premium', 'High-end premium products'),
  ('Budget', 'budget', 'Affordable budget options')
ON CONFLICT (name) DO NOTHING;
