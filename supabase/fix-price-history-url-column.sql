-- SmartBuy AI — add the missing url column to price_history (if missing)
-- =====================================================================
-- PROBLEM (found after the RLS fix, 2026-10-31):
--   After restoring anon SELECT, deals, merchants, coupons, cashback
--   and product-merchant APIs all return data — so those tables' API
--   columns all exist. But two endpoints still return [] even though
--   price_history rows exist (predictions proves it):
--     * GET /api/v1/products/<slug>/prices
--     * POST /api/v1/comparison (retailers [])
--   Both of those queries are the ONLY price_history queries that
--   select the `url` column:
--     select id, product_id, retailer_id, price, currency,
--            availability, url, recorded_at
--   Every working price_history query selects only price and/or
--   recorded_at. The seed insert also never used `url`. So the live
--   price_history table is very likely missing the `url` column, and
--   PostgREST fails the whole query when a selected column is absent
--   (the service then silently returns []).
--
-- FIX:
--   Add the column if it does not exist. This is safe to run even if
--   the column already exists — IF NOT EXISTS makes it a no-op, and
--   it changes no existing data. No redeploy is required.
--
-- HOW TO RUN:
--   Supabase Dashboard -> your project -> SQL Editor -> New query ->
--   paste this whole file -> Run. Then tell Muse, who will re-verify
--   the prices and comparison APIs.
-- =====================================================================

ALTER TABLE price_history ADD COLUMN IF NOT EXISTS url text;

-- Verify: url should now appear in this list ------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'price_history'
ORDER BY ordinal_position;
