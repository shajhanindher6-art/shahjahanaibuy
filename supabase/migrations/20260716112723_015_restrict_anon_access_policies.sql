/*
# Restrict Anonymous Access RLS Policies

## Summary
The Supabase Security Advisor (lint 0012_auth_allow_anonymous_sign_ins) flags
RLS policies that grant access to the `anon` role when anonymous sign-ins are
not enabled in the project's auth configuration. This migration removes the
`anon` role from policies on tables that do NOT need to be publicly readable,
restricting them to `authenticated` only.

## Tables KEPT with anon access (intentionally public — used by no-auth pages)
These 13 tables are queried by public-facing pages (/search, /deals, /compare,
/products/[slug]) that work without authentication:
- products (search, deals, compare, product detail)
- product_images (product detail)
- product_variants (AI summary)
- product_attributes (AI summary)
- price_history (AI search, compare, predictions)
- reviews (product reviews, compare)
- retailers (compare)
- deals (ranked deals)
- deal_rankings (cached rankings)
- ai_summaries (cached AI summaries)
- ai_predictions (cached predictions)
- coupons (product page savings)
- cashback_offers (product page savings)

## Tables RESTRICTED to authenticated only (anon removed)
The following tables had `TO anon, authenticated` policies changed to
`TO authenticated` only:
- affiliate_clicks (INSERT) — only tracked for logged-in affiliate links
- affiliate_links (SELECT) — internal commerce data
- analytics_events (INSERT) — only authenticated user events
- brands (SELECT) — admin/catalog management
- categories (SELECT) — admin/catalog management
- countries (SELECT) — reference data, not used publicly
- currencies (SELECT) — reference data
- data_sources (SELECT) — admin/monitoring
- feature_flags (SELECT) — internal feature management
- languages (SELECT) — reference data
- merchant_products (SELECT) — admin/commerce
- merchants (SELECT) — admin/commerce
- provider_health (SELECT) — monitoring data
- providers (SELECT) — admin/monitoring
- regions (SELECT) — reference data
- review_sources (SELECT) — admin/reference
- roles (SELECT) — admin/reference
- tags (SELECT) — admin/catalog
- product_comparisons (SELECT) — user-generated, auth-only
- product_sources (SELECT) — admin/pipeline
- product_tags (SELECT) — admin/catalog

## Security Changes
- 22 tables: policies changed from `TO anon, authenticated` to `TO authenticated`
- 13 tables: policies kept as `TO anon, authenticated` (intentionally public)
- No data loss — only policy roles changed, not data or schema
*/

-- affiliate_clicks: INSERT only — restrict to authenticated
DROP POLICY IF EXISTS "insert_affiliate_clicks" ON affiliate_clicks;
CREATE POLICY "insert_affiliate_clicks" ON affiliate_clicks
  FOR INSERT TO authenticated WITH CHECK (affiliate_link_id IS NOT NULL);

-- affiliate_links: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_affiliate_links" ON affiliate_links;
CREATE POLICY "read_affiliate_links" ON affiliate_links
  FOR SELECT TO authenticated USING (active = true);

-- analytics_events: INSERT — restrict to authenticated
DROP POLICY IF EXISTS "insert_analytics_events" ON analytics_events;
CREATE POLICY "insert_analytics_events" ON analytics_events
  FOR INSERT TO authenticated WITH CHECK (event_type IS NOT NULL);

-- brands: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_brands" ON brands;
CREATE POLICY "read_brands" ON brands
  FOR SELECT TO authenticated USING (deleted_at IS NULL);

-- categories: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_categories" ON categories;
CREATE POLICY "read_categories" ON categories
  FOR SELECT TO authenticated USING (deleted_at IS NULL);

-- countries: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_countries" ON countries;
CREATE POLICY "read_countries" ON countries
  FOR SELECT TO authenticated USING (active = true);

-- coupons: SELECT — KEEP anon (used on public product page)
-- No change needed

-- currencies: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_currencies" ON currencies;
CREATE POLICY "read_currencies" ON currencies
  FOR SELECT TO authenticated USING (active = true);

-- data_sources: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_data_sources" ON data_sources;
CREATE POLICY "read_data_sources" ON data_sources
  FOR SELECT TO authenticated USING (active = true);

-- deal_rankings: SELECT — KEEP anon (used on public /deals page)
-- No change needed

-- deals: SELECT — KEEP anon (used on public /deals page)
-- No change needed

-- feature_flags: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_feature_flags" ON feature_flags;
CREATE POLICY "read_feature_flags" ON feature_flags
  FOR SELECT TO authenticated USING (id IS NOT NULL);

-- languages: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_languages" ON languages;
CREATE POLICY "read_languages" ON languages
  FOR SELECT TO authenticated USING (active = true);

-- merchant_products: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_merchant_products" ON merchant_products;
CREATE POLICY "read_merchant_products" ON merchant_products
  FOR SELECT TO authenticated USING (deleted_at IS NULL);

-- merchants: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_merchants" ON merchants;
CREATE POLICY "read_merchants" ON merchants
  FOR SELECT TO authenticated USING (active = true AND deleted_at IS NULL);

-- price_history: SELECT — KEEP anon (used on public /search, /compare, /products)
-- No change needed

-- product_attributes: SELECT — KEEP anon (used on public /products/[slug])
-- No change needed

-- product_comparisons: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_product_comparisons" ON product_comparisons;
CREATE POLICY "read_product_comparisons" ON product_comparisons
  FOR SELECT TO authenticated USING (expires_at IS NULL OR expires_at > now());

-- product_images: SELECT — KEEP anon (used on public /products/[slug])
-- No change needed

-- product_sources: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_product_sources" ON product_sources;
CREATE POLICY "read_product_sources" ON product_sources
  FOR SELECT TO authenticated USING (id IS NOT NULL);

-- product_tags: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_product_tags" ON product_tags;
CREATE POLICY "read_product_tags" ON product_tags
  FOR SELECT TO authenticated USING (product_id IS NOT NULL);

-- product_variants: SELECT — KEEP anon (used on public /products/[slug])
-- No change needed

-- products: SELECT — KEEP anon (used on all public pages)
-- No change needed

-- provider_health: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_provider_health" ON provider_health;
CREATE POLICY "read_provider_health" ON provider_health
  FOR SELECT TO authenticated USING (id IS NOT NULL);

-- providers: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_providers" ON providers;
CREATE POLICY "read_providers" ON providers
  FOR SELECT TO authenticated USING (active = true);

-- regions: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_regions" ON regions;
CREATE POLICY "read_regions" ON regions
  FOR SELECT TO authenticated USING (id IS NOT NULL);

-- retailers: SELECT — KEEP anon (used on public /compare page)
-- No change needed

-- review_sources: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_review_sources" ON review_sources;
CREATE POLICY "read_review_sources" ON review_sources
  FOR SELECT TO authenticated USING (active = true);

-- reviews: SELECT — KEEP anon (used on public /products/[slug] and /compare)
-- No change needed

-- roles: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_roles" ON roles;
CREATE POLICY "read_roles" ON roles
  FOR SELECT TO authenticated USING (id IS NOT NULL);

-- tags: SELECT — restrict to authenticated
DROP POLICY IF EXISTS "read_tags" ON tags;
CREATE POLICY "read_tags" ON tags
  FOR SELECT TO authenticated USING (id IS NOT NULL);

-- ai_summaries: SELECT — KEEP anon (used on public /products/[slug] AI summary)
-- No change needed

-- ai_predictions: SELECT — KEEP anon (used on public /products/[slug] predictions)
-- No change needed

-- cashback_offers: SELECT — KEEP anon (used on public /products/[slug] savings)
-- No change needed
