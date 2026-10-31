-- SmartBuy AI — restore public (anon) SELECT for the catalog tables
-- that the public, logged-out site actually queries
-- =====================================================================
-- PROBLEM (confirmed from live pg_policies screenshots, 2026-10-31):
--   The database has the seed rows (Merchants 2, Deals 6, Coupons 2,
--   Cashback 10, Price History 40), but the public APIs still return
--   [] for deals, merchants, coupons, cashback and product merchants.
--   Reason: those tables' only SELECT policy is read_* TO
--   {authenticated}. A logged-out visitor uses the Supabase anon key,
--   so RLS hides every row from them.
--   By contrast, products, retailers and price_history still work
--   because an older *_select_all policy TO {anon, authenticated}
--   still exists for them alongside the authenticated-only read_*
--   policy (permissive policies are OR-ed: any one allowing row wins).
--   Merchants, merchant_products, deals, coupons, cashback_offers and
--   deal_rankings have NO such *_select_all policy left, so anon gets
--   nothing from them.
--
--   This is also a design contradiction in the repo itself: migration
--   015 lists deals, coupons and cashback as "intentionally public —
--   used by no-auth pages" (/deals, /products/[slug] savings tab), yet
--   migration 018 then restricted them to authenticated only.
--
-- WHAT THIS FILE DOES:
--   For each public catalog table, it drops the authenticated-only
--   SELECT policy and recreates it as TO anon, authenticated, keeping
--   the SAME row filter (USING) as before. No data is changed, and
--   INSERT/UPDATE/DELETE policies are NOT touched — anon still cannot
--   write anything. Only public catalog rows become readable without
--   login, which is exactly what the public deals, product, savings
--   and compare pages need.
--
--   It also fixes products, retailers and price_history the same way,
--   so they no longer depend on the leftover *_select_all policies:
--   if those old policies are ever cleaned up, the public pages keep
--   working.
--
-- HOW TO RUN:
--   Supabase Dashboard -> your project -> SQL Editor -> New query ->
--   paste this whole file -> Run. No keys or secrets are needed.
--   Effect is immediate — no redeploy is required. After running it,
--   tell Muse, who will re-verify the live APIs and pages.
--
-- SAFETY NOTE:
--   These tables hold only public shopping data (product, merchant,
--   deal, coupon and cashback listings). They hold no user accounts,
--   passwords, payment data or private user content. Do NOT add
--   private merchant contact details to the merchants table while
--   this policy is in place, because anon SELECT makes the whole
--   table readable through the public API (the seed rows have no
--   contact_email/phone values). User-private tables (wishlists,
--   alerts, profiles, billing_history, notifications, etc.) are
--   deliberately NOT changed here and stay authenticated-only.
-- =====================================================================

-- Merchants: public listings, only active, non-deleted rows ----------
DROP POLICY IF EXISTS "read_merchants" ON merchants;
CREATE POLICY "read_merchants" ON merchants FOR SELECT
  TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);

-- Merchant products: public listings, only non-deleted rows ----------
DROP POLICY IF EXISTS "read_merchant_products" ON merchant_products;
CREATE POLICY "read_merchant_products" ON merchant_products FOR SELECT
  TO anon, authenticated
  USING (deleted_at IS NULL);

-- Deals: public deals, only active, non-deleted rows -----------------
DROP POLICY IF EXISTS "read_deals" ON deals;
CREATE POLICY "read_deals" ON deals FOR SELECT
  TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);

-- Coupons: public coupons, only active rows --------------------------
DROP POLICY IF EXISTS "read_coupons" ON coupons;
CREATE POLICY "read_coupons" ON coupons FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- Cashback offers: public offers, only active, non-deleted rows ------
DROP POLICY IF EXISTS "read_cashback_offers" ON cashback_offers;
CREATE POLICY "read_cashback_offers" ON cashback_offers FOR SELECT
  TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);

-- Deal rankings: cached public rankings ------------------------------
DROP POLICY IF EXISTS "read_deal_rankings" ON deal_rankings;
CREATE POLICY "read_deal_rankings" ON deal_rankings FOR SELECT
  TO anon, authenticated
  USING (id IS NOT NULL);

-- Reviews: public product reviews, only non-deleted rows -------------
-- (policy name in this database is reviews_select_all, not read_reviews)
DROP POLICY IF EXISTS "reviews_select_all" ON reviews;
CREATE POLICY "reviews_select_all" ON reviews FOR SELECT
  TO anon, authenticated
  USING (deleted_at IS NULL);

-- Products, retailers, price_history: make the anon access explicit
-- so it no longer depends on the leftover *_select_all policies -----
DROP POLICY IF EXISTS "read_products" ON products;
CREATE POLICY "read_products" ON products FOR SELECT
  TO anon, authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "read_retailers" ON retailers;
CREATE POLICY "read_retailers" ON retailers FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "read_price_history" ON price_history;
CREATE POLICY "read_price_history" ON price_history FOR SELECT
  TO anon, authenticated
  USING (id IS NOT NULL);

-- Verify: every row below should show roles {anon,authenticated} ----
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'SELECT'
  AND tablename IN ('merchants', 'merchant_products', 'deals',
                    'coupons', 'cashback_offers', 'deal_rankings',
                    'reviews', 'products', 'retailers', 'price_history')
ORDER BY tablename, policyname;
