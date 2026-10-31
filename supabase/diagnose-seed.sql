-- SmartBuy AI — diagnostic queries for the seed-data split
-- =====================================================================
-- Run this read-only file in Supabase SQL Editor and share the
-- results (no keys or secrets are involved — only counts, column
-- names and policy names). It does NOT change any data.
--
-- WHY THIS IS NEEDED:
--   After the seed script ran, price_history data IS visible live
--   (predictions + Price History chart), but merchants, deals,
--   coupons, cashback and the prices endpoint still return empty.
--   The APIs hide query errors and return [] instead, so the only
--   way to tell whether a table is empty, a column is missing, or
--   an RLS policy blocks anonymous reads is to look at the live
--   database directly with these queries.
-- =====================================================================

-- 1. Row counts — which tables actually got seed rows? --------------
SELECT 'merchants' AS table_name, count(*) FROM merchants
UNION ALL SELECT 'retailers', count(*) FROM retailers
UNION ALL SELECT 'merchant_products', count(*) FROM merchant_products
UNION ALL SELECT 'price_history', count(*) FROM price_history
UNION ALL SELECT 'deals', count(*) FROM deals
UNION ALL SELECT 'deals_active_future', count(*) FROM deals WHERE active = true AND end_at > now()
UNION ALL SELECT 'coupons', count(*) FROM coupons
UNION ALL SELECT 'cashback_offers', count(*) FROM cashback_offers
UNION ALL SELECT 'products', count(*) FROM products;

-- 2. Columns — does each table have exactly the columns the API
--    selects? A missing column makes the whole API query fail and
--    the service silently returns [].
--    Expected price_history columns: id, product_id, retailer_id,
--    price, currency, availability, url, recorded_at.
--    Expected merchants columns: id, name, slug, logo_url,
--    website_url, country_id, currency_id, contact_email, phone,
--    status, commission_rate, active, created_at, updated_at,
--    deleted_at.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('merchants', 'merchant_products', 'deals',
                     'coupons', 'cashback_offers', 'price_history',
                     'retailers', 'products')
ORDER BY table_name, ordinal_position;

-- 3. RLS policies — which roles may SELECT each table? -------------
--    The public site reads with the anon key. If a table's SELECT
--    policies list only 'authenticated', logged-out visitors get
--    [] even though rows exist. (The repo's July-18 migration
--    restricted several tables to authenticated only.)
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('merchants', 'merchant_products', 'deals',
                    'coupons', 'cashback_offers', 'price_history',
                    'retailers', 'products')
ORDER BY tablename, policyname;

-- 4. Sample seed rows (first few, to confirm what was inserted) -----
SELECT slug, name, active FROM merchants ORDER BY name LIMIT 5;
SELECT slug, name, active FROM retailers ORDER BY name LIMIT 5;
SELECT title, deal_type, discount_value, active, end_at
FROM deals ORDER BY created_at DESC LIMIT 10;
SELECT code, discount_type, discount_value, active FROM coupons LIMIT 10;
