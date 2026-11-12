-- ============================================================
-- 017 — Admin-only writes for catalog / system / AI tables
-- ============================================================
-- SECURITY FIX (deep audit round 2, 2026-11-05).
--
-- WHAT WAS WRONG (H1 + M4):
--   Migration 010 gave every self-registered user INSERT / UPDATE /
--   DELETE on the whole public catalog (`TO authenticated
--   WITH CHECK (true)`): products, merchant_products, price_history,
--   deals, coupons, and the system tables below. Anyone could sign up,
--   take the public anon key + their JWT, and rewrite prices, plant
--   fake deals on the homepage, or inject fake price history (which
--   also feeds trend charts, Buy-vs-Wait, the fake-sale detector, and
--   can trigger price-drop alert emails to real users). The same
--   pattern covered ai_predictions / ai_summaries /
--   product_comparisons / admin_audit_logs (migration 011).
--
-- WHAT THIS DOES:
--   Replaces each wide-open write policy with an admin-only one:
--   the caller's profiles.role_id must point at a roles row whose
--   name is 'admin' (see is_admin() below). SELECT policies are
--   NOT touched — the public catalog keeps reading exactly as before.
--   The service-role client (ingestion, price refresh, monitoring,
--   geo-click logging) bypasses RLS, so server-side writes are
--   unaffected.
--
-- SECTION 17, STAGE H, ITEM 7 (audit §4 #1) — is_admin() FIX:
--   The original is_admin() read `profiles.role = 'admin'`, but the
--   `profiles` table as created in migration 001 has NO `role`
--   column — only `role_id` (FK to roles.id). On a database matching
--   the migration chain the function errored on every call, so every
--   admin-only policy denied and the admin surface was unusable.
--   is_admin() now joins `profiles.role_id → roles.name = 'admin'`,
--   the same resolution services/profiles.ts already uses in code.
--   ⚠️ DEPENDENCY FLAG: this fix is written against the migration
--   chain. If the live DB turns out to HAVE a `profiles.role`
--   column added out-of-band, this function needs revisiting — the
--   live column, not the join, would be the source of truth then.
--
-- KNOWN BEHAVIOUR CHANGE (documented, not a bug):
--   /api/v1/ai-summary and /api/v1/predictions compute on the fly and
--   cache the result through the SESSION client, fire-and-forget.
--   After this migration the cache write only succeeds when an admin
--   views the product; for everyone else the route still returns the
--   freshly computed result (exactly as it already did for logged-out
--   visitors, whose writes were never permitted). deal_rankings
--   behaves the same way.
--
-- HOW TO APPLY (owner step — the agent cannot run SQL):
--   1. Supabase dashboard -> SQL Editor -> paste this whole file.
--   2. Select ALL (Ctrl+A) -> Run. The editor shows only the LAST
--      statement's result, so scroll to the bottom: the final SELECT
--      must list the new admin-only policies.
--   3. Run `NOTIFY pgrst, 'reload schema';` (included at the end).
--   4. Verify with the SELECT at the end: every row below must show
--      the new policies; if an old `WITH CHECK (true)` policy is
--      still listed for any of these tables, re-run this file.
--
-- CAVEAT (from the audit): the repo's migration files contradict
--   each other on some SELECT policies (e.g. 015 restricts
--   merchant_products SELECT to authenticated, yet the live site
--   serves it logged-out), so the live DB may not match the file
--   chain exactly. This file drops by exact policy NAME, so it is
--   safe to run even if a policy is already gone — but confirm the
--   result with the verification SELECT below.
-- ============================================================

-- Helper: true only for a signed-in admin. SECURITY DEFINER so the
-- profiles lookup is not blocked by profiles' own RLS.
-- Resolves via profiles.role_id -> roles.name: profiles has NO role
-- column in the migration chain (001 creates only role_id).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    WHERE p.id = auth.uid() AND r.name = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- --- brands ---
DROP POLICY IF EXISTS insert_brands ON brands;
DROP POLICY IF EXISTS update_brands ON brands;
DROP POLICY IF EXISTS delete_brands ON brands;
CREATE POLICY insert_brands ON brands FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_brands ON brands FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_brands ON brands FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- categories ---
DROP POLICY IF EXISTS insert_categories ON categories;
DROP POLICY IF EXISTS update_categories ON categories;
DROP POLICY IF EXISTS delete_categories ON categories;
CREATE POLICY insert_categories ON categories FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_categories ON categories FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_categories ON categories FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- countries ---
DROP POLICY IF EXISTS insert_countries ON countries;
DROP POLICY IF EXISTS update_countries ON countries;
DROP POLICY IF EXISTS delete_countries ON countries;
CREATE POLICY insert_countries ON countries FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_countries ON countries FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_countries ON countries FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- coupons ---
DROP POLICY IF EXISTS insert_coupons ON coupons;
DROP POLICY IF EXISTS update_coupons ON coupons;
DROP POLICY IF EXISTS delete_coupons ON coupons;
CREATE POLICY insert_coupons ON coupons FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_coupons ON coupons FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_coupons ON coupons FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- currencies ---
DROP POLICY IF EXISTS insert_currencies ON currencies;
DROP POLICY IF EXISTS update_currencies ON currencies;
DROP POLICY IF EXISTS delete_currencies ON currencies;
CREATE POLICY insert_currencies ON currencies FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_currencies ON currencies FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_currencies ON currencies FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- data_sources ---
DROP POLICY IF EXISTS insert_data_sources ON data_sources;
DROP POLICY IF EXISTS update_data_sources ON data_sources;
DROP POLICY IF EXISTS delete_data_sources ON data_sources;
CREATE POLICY insert_data_sources ON data_sources FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_data_sources ON data_sources FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_data_sources ON data_sources FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- deals ---
DROP POLICY IF EXISTS insert_deals ON deals;
DROP POLICY IF EXISTS update_deals ON deals;
DROP POLICY IF EXISTS delete_deals ON deals;
CREATE POLICY insert_deals ON deals FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_deals ON deals FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_deals ON deals FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- languages ---
DROP POLICY IF EXISTS insert_languages ON languages;
DROP POLICY IF EXISTS update_languages ON languages;
DROP POLICY IF EXISTS delete_languages ON languages;
CREATE POLICY insert_languages ON languages FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_languages ON languages FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_languages ON languages FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- merchants ---
DROP POLICY IF EXISTS insert_merchants ON merchants;
DROP POLICY IF EXISTS update_merchants ON merchants;
DROP POLICY IF EXISTS delete_merchants ON merchants;
CREATE POLICY insert_merchants ON merchants FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_merchants ON merchants FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_merchants ON merchants FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- merchant_products ---
DROP POLICY IF EXISTS insert_merchant_products ON merchant_products;
DROP POLICY IF EXISTS update_merchant_products ON merchant_products;
DROP POLICY IF EXISTS delete_merchant_products ON merchant_products;
CREATE POLICY insert_merchant_products ON merchant_products FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_merchant_products ON merchant_products FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_merchant_products ON merchant_products FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- price_history ---
DROP POLICY IF EXISTS insert_price_history ON price_history;
DROP POLICY IF EXISTS update_price_history ON price_history;
DROP POLICY IF EXISTS delete_price_history ON price_history;
CREATE POLICY insert_price_history ON price_history FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_price_history ON price_history FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_price_history ON price_history FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- product_attributes ---
DROP POLICY IF EXISTS insert_product_attributes ON product_attributes;
DROP POLICY IF EXISTS update_product_attributes ON product_attributes;
DROP POLICY IF EXISTS delete_product_attributes ON product_attributes;
CREATE POLICY insert_product_attributes ON product_attributes FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_product_attributes ON product_attributes FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_product_attributes ON product_attributes FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- product_images ---
DROP POLICY IF EXISTS insert_product_images ON product_images;
DROP POLICY IF EXISTS update_product_images ON product_images;
DROP POLICY IF EXISTS delete_product_images ON product_images;
CREATE POLICY insert_product_images ON product_images FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_product_images ON product_images FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_product_images ON product_images FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- product_sources ---
DROP POLICY IF EXISTS insert_product_sources ON product_sources;
DROP POLICY IF EXISTS update_product_sources ON product_sources;
DROP POLICY IF EXISTS delete_product_sources ON product_sources;
CREATE POLICY insert_product_sources ON product_sources FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_product_sources ON product_sources FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_product_sources ON product_sources FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- product_tags ---
DROP POLICY IF EXISTS insert_product_tags ON product_tags;
DROP POLICY IF EXISTS update_product_tags ON product_tags;
DROP POLICY IF EXISTS delete_product_tags ON product_tags;
CREATE POLICY insert_product_tags ON product_tags FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_product_tags ON product_tags FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_product_tags ON product_tags FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- product_variants ---
DROP POLICY IF EXISTS insert_product_variants ON product_variants;
DROP POLICY IF EXISTS update_product_variants ON product_variants;
DROP POLICY IF EXISTS delete_product_variants ON product_variants;
CREATE POLICY insert_product_variants ON product_variants FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_product_variants ON product_variants FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_product_variants ON product_variants FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- products ---
DROP POLICY IF EXISTS insert_products ON products;
DROP POLICY IF EXISTS update_products ON products;
DROP POLICY IF EXISTS delete_products ON products;
CREATE POLICY insert_products ON products FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_products ON products FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_products ON products FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- regions ---
DROP POLICY IF EXISTS insert_regions ON regions;
DROP POLICY IF EXISTS update_regions ON regions;
DROP POLICY IF EXISTS delete_regions ON regions;
CREATE POLICY insert_regions ON regions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_regions ON regions FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_regions ON regions FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- retailers ---
DROP POLICY IF EXISTS insert_retailers ON retailers;
DROP POLICY IF EXISTS update_retailers ON retailers;
DROP POLICY IF EXISTS delete_retailers ON retailers;
CREATE POLICY insert_retailers ON retailers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_retailers ON retailers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_retailers ON retailers FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- review_sources ---
DROP POLICY IF EXISTS insert_review_sources ON review_sources;
DROP POLICY IF EXISTS update_review_sources ON review_sources;
DROP POLICY IF EXISTS delete_review_sources ON review_sources;
CREATE POLICY insert_review_sources ON review_sources FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_review_sources ON review_sources FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_review_sources ON review_sources FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- affiliate_clicks ---
DROP POLICY IF EXISTS insert_affiliate_clicks ON affiliate_clicks;
DROP POLICY IF EXISTS update_affiliate_clicks ON affiliate_clicks;
DROP POLICY IF EXISTS delete_affiliate_clicks ON affiliate_clicks;
CREATE POLICY insert_affiliate_clicks ON affiliate_clicks FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_affiliate_clicks ON affiliate_clicks FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_affiliate_clicks ON affiliate_clicks FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- affiliate_links ---
DROP POLICY IF EXISTS insert_affiliate_links ON affiliate_links;
DROP POLICY IF EXISTS update_affiliate_links ON affiliate_links;
DROP POLICY IF EXISTS delete_affiliate_links ON affiliate_links;
CREATE POLICY insert_affiliate_links ON affiliate_links FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_affiliate_links ON affiliate_links FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_affiliate_links ON affiliate_links FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- api_rate_limits ---
DROP POLICY IF EXISTS insert_api_rate_limits ON api_rate_limits;
DROP POLICY IF EXISTS update_api_rate_limits ON api_rate_limits;
DROP POLICY IF EXISTS delete_api_rate_limits ON api_rate_limits;
CREATE POLICY insert_api_rate_limits ON api_rate_limits FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_api_rate_limits ON api_rate_limits FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_api_rate_limits ON api_rate_limits FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- cache_metrics ---
DROP POLICY IF EXISTS insert_cache_metrics ON cache_metrics;
DROP POLICY IF EXISTS update_cache_metrics ON cache_metrics;
DROP POLICY IF EXISTS delete_cache_metrics ON cache_metrics;
CREATE POLICY insert_cache_metrics ON cache_metrics FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_cache_metrics ON cache_metrics FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_cache_metrics ON cache_metrics FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- cashback_offers ---
DROP POLICY IF EXISTS insert_cashback_offers ON cashback_offers;
DROP POLICY IF EXISTS update_cashback_offers ON cashback_offers;
DROP POLICY IF EXISTS delete_cashback_offers ON cashback_offers;
CREATE POLICY insert_cashback_offers ON cashback_offers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_cashback_offers ON cashback_offers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_cashback_offers ON cashback_offers FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- deal_rankings ---
DROP POLICY IF EXISTS insert_deal_rankings ON deal_rankings;
DROP POLICY IF EXISTS update_deal_rankings ON deal_rankings;
DROP POLICY IF EXISTS delete_deal_rankings ON deal_rankings;
CREATE POLICY insert_deal_rankings ON deal_rankings FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_deal_rankings ON deal_rankings FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_deal_rankings ON deal_rankings FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- feature_flags ---
DROP POLICY IF EXISTS insert_feature_flags ON feature_flags;
DROP POLICY IF EXISTS update_feature_flags ON feature_flags;
DROP POLICY IF EXISTS delete_feature_flags ON feature_flags;
CREATE POLICY insert_feature_flags ON feature_flags FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_feature_flags ON feature_flags FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_feature_flags ON feature_flags FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- provider_health ---
DROP POLICY IF EXISTS insert_provider_health ON provider_health;
DROP POLICY IF EXISTS update_provider_health ON provider_health;
DROP POLICY IF EXISTS delete_provider_health ON provider_health;
CREATE POLICY insert_provider_health ON provider_health FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_provider_health ON provider_health FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_provider_health ON provider_health FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- providers ---
DROP POLICY IF EXISTS insert_providers ON providers;
DROP POLICY IF EXISTS update_providers ON providers;
DROP POLICY IF EXISTS delete_providers ON providers;
CREATE POLICY insert_providers ON providers FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_providers ON providers FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_providers ON providers FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- queue_metrics ---
DROP POLICY IF EXISTS insert_queue_metrics ON queue_metrics;
DROP POLICY IF EXISTS update_queue_metrics ON queue_metrics;
DROP POLICY IF EXISTS delete_queue_metrics ON queue_metrics;
CREATE POLICY insert_queue_metrics ON queue_metrics FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_queue_metrics ON queue_metrics FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_queue_metrics ON queue_metrics FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- roles ---
DROP POLICY IF EXISTS insert_roles ON roles;
DROP POLICY IF EXISTS update_roles ON roles;
DROP POLICY IF EXISTS delete_roles ON roles;
CREATE POLICY insert_roles ON roles FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_roles ON roles FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_roles ON roles FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- sync_history ---
DROP POLICY IF EXISTS insert_sync_history ON sync_history;
DROP POLICY IF EXISTS update_sync_history ON sync_history;
DROP POLICY IF EXISTS delete_sync_history ON sync_history;
CREATE POLICY insert_sync_history ON sync_history FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_sync_history ON sync_history FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_sync_history ON sync_history FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- system_settings ---
DROP POLICY IF EXISTS insert_system_settings ON system_settings;
DROP POLICY IF EXISTS update_system_settings ON system_settings;
DROP POLICY IF EXISTS delete_system_settings ON system_settings;
CREATE POLICY insert_system_settings ON system_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_system_settings ON system_settings FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_system_settings ON system_settings FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- tags ---
DROP POLICY IF EXISTS insert_tags ON tags;
DROP POLICY IF EXISTS update_tags ON tags;
DROP POLICY IF EXISTS delete_tags ON tags;
CREATE POLICY insert_tags ON tags FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_tags ON tags FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_tags ON tags FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- admin_audit_logs ---
-- Section 18, item 15 — APPEND-ONLY: the audit log is a tamper-evident
-- record, so ONLY the INSERT policy is granted (admin-only). There is
-- deliberately NO UPDATE or DELETE policy: RLS default-deny rejects any
-- UPDATE / DELETE on audit rows, including by admins. The DROP POLICY
-- IF EXISTS lines below remove the old admin UPDATE/DELETE policies on
-- re-apply, so a database that already has them becomes append-only too.
-- (The service-role client bypasses RLS, but app code never updates or
-- deletes audit rows — recordAdminAction only inserts.)
DROP POLICY IF EXISTS insert_admin_audit_logs ON admin_audit_logs;
DROP POLICY IF EXISTS update_admin_audit_logs ON admin_audit_logs;
DROP POLICY IF EXISTS delete_admin_audit_logs ON admin_audit_logs;
CREATE POLICY insert_admin_audit_logs ON admin_audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- --- ai_predictions ---
DROP POLICY IF EXISTS insert_ai_predictions ON ai_predictions;
DROP POLICY IF EXISTS update_ai_predictions ON ai_predictions;
DROP POLICY IF EXISTS delete_ai_predictions ON ai_predictions;
CREATE POLICY insert_ai_predictions ON ai_predictions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_ai_predictions ON ai_predictions FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_ai_predictions ON ai_predictions FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- ai_summaries ---
DROP POLICY IF EXISTS insert_ai_summaries ON ai_summaries;
DROP POLICY IF EXISTS update_ai_summaries ON ai_summaries;
DROP POLICY IF EXISTS delete_ai_summaries ON ai_summaries;
CREATE POLICY insert_ai_summaries ON ai_summaries FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_ai_summaries ON ai_summaries FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_ai_summaries ON ai_summaries FOR DELETE TO authenticated
  USING (public.is_admin());

-- --- product_comparisons ---
DROP POLICY IF EXISTS insert_product_comparisons ON product_comparisons;
DROP POLICY IF EXISTS update_product_comparisons ON product_comparisons;
DROP POLICY IF EXISTS delete_product_comparisons ON product_comparisons;
CREATE POLICY insert_product_comparisons ON product_comparisons FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY update_product_comparisons ON product_comparisons FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY delete_product_comparisons ON product_comparisons FOR DELETE TO authenticated
  USING (public.is_admin());

-- Reload the PostgREST schema cache so the new policies apply immediately.
NOTIFY pgrst, 'reload schema';

-- VERIFICATION (last statement: this is what the editor shows).
-- Expect one row per policy below (3 per table), all with the new
-- admin-only definitions — EXCEPT admin_audit_logs, which is
-- append-only by design (Section 18, item 15) and has only its
-- INSERT policy. If a table is missing here, its policies
-- were already dropped/renamed by a later migration — check
-- pg_policies for that table before assuming the hole is closed.
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'brands', 'categories', 'countries', 'coupons', 'currencies',
    'data_sources', 'deals', 'languages', 'merchants', 'merchant_products',
    'price_history', 'product_attributes', 'product_images',
    'product_sources', 'product_tags', 'product_variants', 'products',
    'regions', 'retailers', 'review_sources',
    'affiliate_clicks', 'affiliate_links', 'api_rate_limits',
    'cache_metrics', 'cashback_offers', 'deal_rankings', 'feature_flags',
    'provider_health', 'providers', 'queue_metrics', 'roles',
    'sync_history', 'system_settings', 'tags',
    'admin_audit_logs', 'ai_predictions', 'ai_summaries',
    'product_comparisons'
  )
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
ORDER BY tablename, cmd;
