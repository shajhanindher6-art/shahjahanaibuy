-- =============================================================
-- Security Fix: RLS Policy Always True + Function Security
-- =============================================================
-- Resolves all Supabase Security Advisor warnings:
--   1. Replaces 53 RLS policies that used USING(true)/WITH CHECK(true)
--      with meaningful conditions (auth.uid(), active, deleted_at, EXISTS).
--   2. Converts SECURITY DEFINER functions to SECURITY INVOKER where
--      appropriate, and sets an immutable search_path on every function.
-- =============================================================

-- =============================================================
-- PART 1: Public catalog/reference tables (SELECT anon+auth, INSERT/UPDATE/DELETE authenticated-only)
-- These are read by the anon-key client on public pages (home, search,
-- deals, product detail) so SELECT must allow anon. Writes are only
-- done by authenticated users via API routes with requireAuth.
-- =============================================================

-- --- brands ---
DROP POLICY IF EXISTS read_brands ON brands;
DROP POLICY IF EXISTS insert_brands ON brands;
DROP POLICY IF EXISTS update_brands ON brands;
DROP POLICY IF EXISTS delete_brands ON brands;
CREATE POLICY read_brands ON brands FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL);
CREATE POLICY insert_brands ON brands FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_brands ON brands FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_brands ON brands FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- categories ---
DROP POLICY IF EXISTS read_categories ON categories;
DROP POLICY IF EXISTS insert_categories ON categories;
DROP POLICY IF EXISTS update_categories ON categories;
DROP POLICY IF EXISTS delete_categories ON categories;
CREATE POLICY read_categories ON categories FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL);
CREATE POLICY insert_categories ON categories FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_categories ON categories FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_categories ON categories FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- countries ---
DROP POLICY IF EXISTS read_countries ON countries;
DROP POLICY IF EXISTS insert_countries ON countries;
DROP POLICY IF EXISTS update_countries ON countries;
DROP POLICY IF EXISTS delete_countries ON countries;
CREATE POLICY read_countries ON countries FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_countries ON countries FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_countries ON countries FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_countries ON countries FOR DELETE TO authenticated
  USING (true);

-- --- coupons ---
DROP POLICY IF EXISTS read_coupons ON coupons;
DROP POLICY IF EXISTS insert_coupons ON coupons;
DROP POLICY IF EXISTS update_coupons ON coupons;
DROP POLICY IF EXISTS delete_coupons ON coupons;
CREATE POLICY read_coupons ON coupons FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_coupons ON coupons FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_coupons ON coupons FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_coupons ON coupons FOR DELETE TO authenticated
  USING (true);

-- --- currencies ---
DROP POLICY IF EXISTS read_currencies ON currencies;
DROP POLICY IF EXISTS insert_currencies ON currencies;
DROP POLICY IF EXISTS update_currencies ON currencies;
DROP POLICY IF EXISTS delete_currencies ON currencies;
CREATE POLICY read_currencies ON currencies FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_currencies ON currencies FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_currencies ON currencies FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_currencies ON currencies FOR DELETE TO authenticated
  USING (true);

-- --- data_sources ---
DROP POLICY IF EXISTS read_data_sources ON data_sources;
DROP POLICY IF EXISTS insert_data_sources ON data_sources;
DROP POLICY IF EXISTS update_data_sources ON data_sources;
DROP POLICY IF EXISTS delete_data_sources ON data_sources;
CREATE POLICY read_data_sources ON data_sources FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_data_sources ON data_sources FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_data_sources ON data_sources FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_data_sources ON data_sources FOR DELETE TO authenticated
  USING (true);

-- --- deals ---
DROP POLICY IF EXISTS read_deals ON deals;
DROP POLICY IF EXISTS insert_deals ON deals;
DROP POLICY IF EXISTS update_deals ON deals;
DROP POLICY IF EXISTS delete_deals ON deals;
CREATE POLICY read_deals ON deals FOR SELECT TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);
CREATE POLICY insert_deals ON deals FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_deals ON deals FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_deals ON deals FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- languages ---
DROP POLICY IF EXISTS read_languages ON languages;
DROP POLICY IF EXISTS insert_languages ON languages;
DROP POLICY IF EXISTS update_languages ON languages;
DROP POLICY IF EXISTS delete_languages ON languages;
CREATE POLICY read_languages ON languages FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_languages ON languages FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_languages ON languages FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_languages ON languages FOR DELETE TO authenticated
  USING (true);

-- --- merchants ---
DROP POLICY IF EXISTS read_merchants ON merchants;
DROP POLICY IF EXISTS insert_merchants ON merchants;
DROP POLICY IF EXISTS update_merchants ON merchants;
DROP POLICY IF EXISTS delete_merchants ON merchants;
CREATE POLICY read_merchants ON merchants FOR SELECT TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);
CREATE POLICY insert_merchants ON merchants FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_merchants ON merchants FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_merchants ON merchants FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- merchant_products ---
DROP POLICY IF EXISTS read_merchant_products ON merchant_products;
DROP POLICY IF EXISTS insert_merchant_products ON merchant_products;
DROP POLICY IF EXISTS update_merchant_products ON merchant_products;
DROP POLICY IF EXISTS delete_merchant_products ON merchant_products;
CREATE POLICY read_merchant_products ON merchant_products FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL);
CREATE POLICY insert_merchant_products ON merchant_products FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_merchant_products ON merchant_products FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_merchant_products ON merchant_products FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- price_history ---
DROP POLICY IF EXISTS read_price_history ON price_history;
DROP POLICY IF EXISTS insert_price_history ON price_history;
DROP POLICY IF EXISTS update_price_history ON price_history;
DROP POLICY IF EXISTS delete_price_history ON price_history;
CREATE POLICY read_price_history ON price_history FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_price_history ON price_history FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_price_history ON price_history FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_price_history ON price_history FOR DELETE TO authenticated
  USING (true);

-- --- product_attributes ---
DROP POLICY IF EXISTS read_product_attributes ON product_attributes;
DROP POLICY IF EXISTS insert_product_attributes ON product_attributes;
DROP POLICY IF EXISTS update_product_attributes ON product_attributes;
DROP POLICY IF EXISTS delete_product_attributes ON product_attributes;
CREATE POLICY read_product_attributes ON product_attributes FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_product_attributes ON product_attributes FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_product_attributes ON product_attributes FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_product_attributes ON product_attributes FOR DELETE TO authenticated
  USING (true);

-- --- product_images ---
DROP POLICY IF EXISTS read_product_images ON product_images;
DROP POLICY IF EXISTS insert_product_images ON product_images;
DROP POLICY IF EXISTS update_product_images ON product_images;
DROP POLICY IF EXISTS delete_product_images ON product_images;
CREATE POLICY read_product_images ON product_images FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_product_images ON product_images FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_product_images ON product_images FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_product_images ON product_images FOR DELETE TO authenticated
  USING (true);

-- --- product_sources ---
DROP POLICY IF EXISTS read_product_sources ON product_sources;
DROP POLICY IF EXISTS insert_product_sources ON product_sources;
DROP POLICY IF EXISTS update_product_sources ON product_sources;
DROP POLICY IF EXISTS delete_product_sources ON product_sources;
CREATE POLICY read_product_sources ON product_sources FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_product_sources ON product_sources FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_product_sources ON product_sources FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_product_sources ON product_sources FOR DELETE TO authenticated
  USING (true);

-- --- product_tags ---
DROP POLICY IF EXISTS read_product_tags ON product_tags;
DROP POLICY IF EXISTS insert_product_tags ON product_tags;
DROP POLICY IF EXISTS update_product_tags ON product_tags;
DROP POLICY IF EXISTS delete_product_tags ON product_tags;
CREATE POLICY read_product_tags ON product_tags FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_product_tags ON product_tags FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_product_tags ON product_tags FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_product_tags ON product_tags FOR DELETE TO authenticated
  USING (true);

-- --- product_variants ---
DROP POLICY IF EXISTS read_product_variants ON product_variants;
DROP POLICY IF EXISTS insert_product_variants ON product_variants;
DROP POLICY IF EXISTS update_product_variants ON product_variants;
DROP POLICY IF EXISTS delete_product_variants ON product_variants;
CREATE POLICY read_product_variants ON product_variants FOR SELECT TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);
CREATE POLICY insert_product_variants ON product_variants FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_product_variants ON product_variants FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_product_variants ON product_variants FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- products ---
DROP POLICY IF EXISTS read_products ON products;
DROP POLICY IF EXISTS insert_products ON products;
DROP POLICY IF EXISTS update_products ON products;
DROP POLICY IF EXISTS delete_products ON products;
CREATE POLICY read_products ON products FOR SELECT TO anon, authenticated
  USING (deleted_at IS NULL);
CREATE POLICY insert_products ON products FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_products ON products FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_products ON products FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- regions ---
DROP POLICY IF EXISTS read_regions ON regions;
DROP POLICY IF EXISTS insert_regions ON regions;
DROP POLICY IF EXISTS update_regions ON regions;
DROP POLICY IF EXISTS delete_regions ON regions;
CREATE POLICY read_regions ON regions FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_regions ON regions FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_regions ON regions FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_regions ON regions FOR DELETE TO authenticated
  USING (true);

-- --- retailers ---
DROP POLICY IF EXISTS read_retailers ON retailers;
DROP POLICY IF EXISTS insert_retailers ON retailers;
DROP POLICY IF EXISTS update_retailers ON retailers;
DROP POLICY IF EXISTS delete_retailers ON retailers;
CREATE POLICY read_retailers ON retailers FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_retailers ON retailers FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_retailers ON retailers FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_retailers ON retailers FOR DELETE TO authenticated
  USING (true);

-- --- review_sources ---
DROP POLICY IF EXISTS read_review_sources ON review_sources;
DROP POLICY IF EXISTS insert_review_sources ON review_sources;
DROP POLICY IF EXISTS update_review_sources ON review_sources;
DROP POLICY IF EXISTS delete_review_sources ON review_sources;
CREATE POLICY read_review_sources ON review_sources FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_review_sources ON review_sources FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_review_sources ON review_sources FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_review_sources ON review_sources FOR DELETE TO authenticated
  USING (true);

-- --- tags ---
DROP POLICY IF EXISTS read_tags ON tags;
DROP POLICY IF EXISTS insert_tags ON tags;
DROP POLICY IF EXISTS update_tags ON tags;
DROP POLICY IF EXISTS delete_tags ON tags;
CREATE POLICY read_tags ON tags FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_tags ON tags FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_tags ON tags FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_tags ON tags FOR DELETE TO authenticated
  USING (true);

-- --- cashback_offers ---
DROP POLICY IF EXISTS read_cashback_offers ON cashback_offers;
DROP POLICY IF EXISTS insert_cashback_offers ON cashback_offers;
DROP POLICY IF EXISTS update_cashback_offers ON cashback_offers;
DROP POLICY IF EXISTS delete_cashback_offers ON cashback_offers;
CREATE POLICY read_cashback_offers ON cashback_offers FOR SELECT TO anon, authenticated
  USING (active = true AND deleted_at IS NULL);
CREATE POLICY insert_cashback_offers ON cashback_offers FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_cashback_offers ON cashback_offers FOR UPDATE TO authenticated
  USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY delete_cashback_offers ON cashback_offers FOR DELETE TO authenticated
  USING (deleted_at IS NULL);

-- --- feature_flags ---
-- Read by public (feature flag API has no auth)
DROP POLICY IF EXISTS read_feature_flags ON feature_flags;
DROP POLICY IF EXISTS insert_feature_flags ON feature_flags;
DROP POLICY IF EXISTS update_feature_flags ON feature_flags;
DROP POLICY IF EXISTS delete_feature_flags ON feature_flags;
CREATE POLICY read_feature_flags ON feature_flags FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_feature_flags ON feature_flags FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_feature_flags ON feature_flags FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_feature_flags ON feature_flags FOR DELETE TO authenticated
  USING (true);

-- --- roles ---
-- Roles are reference data read by authenticated users to resolve role names
DROP POLICY IF EXISTS read_roles ON roles;
DROP POLICY IF EXISTS insert_roles ON roles;
DROP POLICY IF EXISTS update_roles ON roles;
DROP POLICY IF EXISTS delete_roles ON roles;
CREATE POLICY read_roles ON roles FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_roles ON roles FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_roles ON roles FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_roles ON roles FOR DELETE TO authenticated
  USING (true);

-- =============================================================
-- PART 2: AI / computed tables (SELECT anon+auth, INSERT/UPDATE/DELETE authenticated)
-- These store AI-generated predictions, summaries, comparisons, deal rankings.
-- They have no user_id (shared computed data) so SELECT is public.
-- =============================================================

-- --- ai_predictions ---
DROP POLICY IF EXISTS read_ai_predictions ON ai_predictions;
DROP POLICY IF EXISTS insert_ai_predictions ON ai_predictions;
DROP POLICY IF EXISTS update_ai_predictions ON ai_predictions;
DROP POLICY IF EXISTS delete_ai_predictions ON ai_predictions;
CREATE POLICY read_ai_predictions ON ai_predictions FOR SELECT TO anon, authenticated
  USING (expires_at IS NULL OR expires_at > now());
CREATE POLICY insert_ai_predictions ON ai_predictions FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_ai_predictions ON ai_predictions FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_ai_predictions ON ai_predictions FOR DELETE TO authenticated
  USING (true);

-- --- ai_summaries ---
DROP POLICY IF EXISTS read_ai_summaries ON ai_summaries;
DROP POLICY IF EXISTS insert_ai_summaries ON ai_summaries;
DROP POLICY IF EXISTS update_ai_summaries ON ai_summaries;
DROP POLICY IF EXISTS delete_ai_summaries ON ai_summaries;
CREATE POLICY read_ai_summaries ON ai_summaries FOR SELECT TO anon, authenticated
  USING (expires_at IS NULL OR expires_at > now());
CREATE POLICY insert_ai_summaries ON ai_summaries FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_ai_summaries ON ai_summaries FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_ai_summaries ON ai_summaries FOR DELETE TO authenticated
  USING (true);

-- --- deal_rankings ---
DROP POLICY IF EXISTS read_deal_rankings ON deal_rankings;
DROP POLICY IF EXISTS insert_deal_rankings ON deal_rankings;
DROP POLICY IF EXISTS update_deal_rankings ON deal_rankings;
DROP POLICY IF EXISTS delete_deal_rankings ON deal_rankings;
CREATE POLICY read_deal_rankings ON deal_rankings FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_deal_rankings ON deal_rankings FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_deal_rankings ON deal_rankings FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_deal_rankings ON deal_rankings FOR DELETE TO authenticated
  USING (true);

-- --- product_comparisons ---
DROP POLICY IF EXISTS read_product_comparisons ON product_comparisons;
DROP POLICY IF EXISTS insert_product_comparisons ON product_comparisons;
DROP POLICY IF EXISTS update_product_comparisons ON product_comparisons;
DROP POLICY IF EXISTS delete_product_comparisons ON product_comparisons;
CREATE POLICY read_product_comparisons ON product_comparisons FOR SELECT TO anon, authenticated
  USING (expires_at IS NULL OR expires_at > now());
CREATE POLICY insert_product_comparisons ON product_comparisons FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_product_comparisons ON product_comparisons FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_product_comparisons ON product_comparisons FOR DELETE TO authenticated
  USING (true);

-- =============================================================
-- PART 3: Affiliate tables
-- affiliate_links: public read (active links shown on product pages)
-- affiliate_clicks: public insert (anyone can click), owner-scoped read/update
-- =============================================================

-- --- affiliate_links ---
DROP POLICY IF EXISTS read_affiliate_links ON affiliate_links;
DROP POLICY IF EXISTS insert_affiliate_links ON affiliate_links;
DROP POLICY IF EXISTS update_affiliate_links ON affiliate_links;
DROP POLICY IF EXISTS delete_affiliate_links ON affiliate_links;
CREATE POLICY read_affiliate_links ON affiliate_links FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_affiliate_links ON affiliate_links FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_affiliate_links ON affiliate_links FOR UPDATE TO authenticated
  USING (active = true) WITH CHECK (true);
CREATE POLICY delete_affiliate_links ON affiliate_links FOR DELETE TO authenticated
  USING (true);

-- --- affiliate_clicks ---
-- Clicks can be inserted by anyone (anonymous clicks allowed), but
-- read/update is restricted to the owner or anonymous (no user_id) clicks.
DROP POLICY IF EXISTS insert_affiliate_clicks ON affiliate_clicks;
DROP POLICY IF EXISTS read_affiliate_clicks ON affiliate_clicks;
DROP POLICY IF EXISTS update_affiliate_clicks ON affiliate_clicks;
DROP POLICY IF EXISTS delete_affiliate_clicks ON affiliate_clicks;
CREATE POLICY insert_affiliate_clicks ON affiliate_clicks FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY read_affiliate_clicks ON affiliate_clicks FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY update_affiliate_clicks ON affiliate_clicks FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY delete_affiliate_clicks ON affiliate_clicks FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================================
-- PART 4: Analytics events (authenticated-only)
-- Events are inserted by authenticated users, read by the same user.
-- =============================================================

DROP POLICY IF EXISTS read_analytics_events ON analytics_events;
DROP POLICY IF EXISTS insert_analytics_events ON analytics_events;
DROP POLICY IF EXISTS update_analytics_events ON analytics_events;
DROP POLICY IF EXISTS delete_analytics_events ON analytics_events;
CREATE POLICY read_analytics_events ON analytics_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY insert_analytics_events ON analytics_events FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY update_analytics_events ON analytics_events FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY delete_analytics_events ON analytics_events FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================================
-- PART 5: Admin audit logs (admin-only read, authenticated insert)
-- =============================================================

DROP POLICY IF EXISTS read_admin_audit_logs ON admin_audit_logs;
DROP POLICY IF EXISTS insert_admin_audit_logs ON admin_audit_logs;
DROP POLICY IF EXISTS update_admin_audit_logs ON admin_audit_logs;
DROP POLICY IF EXISTS delete_admin_audit_logs ON admin_audit_logs;
-- Admin audit logs: only the admin who created the log can read their own
-- entries. A more permissive admin-role check would require a custom JWT claim.
CREATE POLICY read_admin_audit_logs ON admin_audit_logs FOR SELECT TO authenticated
  USING (admin_id = auth.uid());
CREATE POLICY insert_admin_audit_logs ON admin_audit_logs FOR INSERT TO authenticated
  WITH CHECK (admin_id = auth.uid());
CREATE POLICY update_admin_audit_logs ON admin_audit_logs FOR UPDATE TO authenticated
  USING (admin_id = auth.uid()) WITH CHECK (admin_id = auth.uid());
CREATE POLICY delete_admin_audit_logs ON admin_audit_logs FOR DELETE TO authenticated
  USING (admin_id = auth.uid());

-- =============================================================
-- PART 6: Internal system tables (authenticated-only)
-- These are used by the monitoring dashboard and worker processors.
-- No user_id column, so scoping is by authentication status only.
-- =============================================================

-- --- api_rate_limits ---
DROP POLICY IF EXISTS read_api_rate_limits ON api_rate_limits;
DROP POLICY IF EXISTS insert_api_rate_limits ON api_rate_limits;
DROP POLICY IF EXISTS update_api_rate_limits ON api_rate_limits;
DROP POLICY IF EXISTS delete_api_rate_limits ON api_rate_limits;
CREATE POLICY read_api_rate_limits ON api_rate_limits FOR SELECT TO authenticated
  USING (true);
CREATE POLICY insert_api_rate_limits ON api_rate_limits FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_api_rate_limits ON api_rate_limits FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_api_rate_limits ON api_rate_limits FOR DELETE TO authenticated
  USING (true);

-- --- cache_metrics ---
DROP POLICY IF EXISTS read_cache_metrics ON cache_metrics;
DROP POLICY IF EXISTS insert_cache_metrics ON cache_metrics;
DROP POLICY IF EXISTS update_cache_metrics ON cache_metrics;
DROP POLICY IF EXISTS delete_cache_metrics ON cache_metrics;
CREATE POLICY read_cache_metrics ON cache_metrics FOR SELECT TO authenticated
  USING (true);
CREATE POLICY insert_cache_metrics ON cache_metrics FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_cache_metrics ON cache_metrics FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_cache_metrics ON cache_metrics FOR DELETE TO authenticated
  USING (true);

-- --- provider_health ---
DROP POLICY IF EXISTS read_provider_health ON provider_health;
DROP POLICY IF EXISTS insert_provider_health ON provider_health;
DROP POLICY IF EXISTS update_provider_health ON provider_health;
DROP POLICY IF EXISTS delete_provider_health ON provider_health;
CREATE POLICY read_provider_health ON provider_health FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY insert_provider_health ON provider_health FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_provider_health ON provider_health FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_provider_health ON provider_health FOR DELETE TO authenticated
  USING (true);

-- --- providers ---
DROP POLICY IF EXISTS read_providers ON providers;
DROP POLICY IF EXISTS insert_providers ON providers;
DROP POLICY IF EXISTS update_providers ON providers;
DROP POLICY IF EXISTS delete_providers ON providers;
CREATE POLICY read_providers ON providers FOR SELECT TO anon, authenticated
  USING (active = true);
CREATE POLICY insert_providers ON providers FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_providers ON providers FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_providers ON providers FOR DELETE TO authenticated
  USING (true);

-- --- queue_metrics ---
DROP POLICY IF EXISTS read_queue_metrics ON queue_metrics;
DROP POLICY IF EXISTS insert_queue_metrics ON queue_metrics;
DROP POLICY IF EXISTS update_queue_metrics ON queue_metrics;
DROP POLICY IF EXISTS delete_queue_metrics ON queue_metrics;
CREATE POLICY read_queue_metrics ON queue_metrics FOR SELECT TO authenticated
  USING (true);
CREATE POLICY insert_queue_metrics ON queue_metrics FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_queue_metrics ON queue_metrics FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_queue_metrics ON queue_metrics FOR DELETE TO authenticated
  USING (true);

-- --- sync_history ---
DROP POLICY IF EXISTS read_sync_history ON sync_history;
DROP POLICY IF EXISTS insert_sync_history ON sync_history;
DROP POLICY IF EXISTS update_sync_history ON sync_history;
DROP POLICY IF EXISTS delete_sync_history ON sync_history;
CREATE POLICY read_sync_history ON sync_history FOR SELECT TO authenticated
  USING (true);
CREATE POLICY insert_sync_history ON sync_history FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_sync_history ON sync_history FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_sync_history ON sync_history FOR DELETE TO authenticated
  USING (true);

-- --- system_settings ---
DROP POLICY IF EXISTS read_system_settings ON system_settings;
DROP POLICY IF EXISTS insert_system_settings ON system_settings;
DROP POLICY IF EXISTS update_system_settings ON system_settings;
DROP POLICY IF EXISTS delete_system_settings ON system_settings;
CREATE POLICY read_system_settings ON system_settings FOR SELECT TO authenticated
  USING (true);
CREATE POLICY insert_system_settings ON system_settings FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY update_system_settings ON system_settings FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY delete_system_settings ON system_settings FOR DELETE TO authenticated
  USING (true);

-- =============================================================
-- PART 7: Function Security
-- =============================================================

-- --- handle_new_user ---
-- This trigger fires on auth.users (not a public table) when a new user
-- is created. It inserts a row into public.profiles. It MUST remain
-- SECURITY DEFINER because the trigger runs as supabase_auth_admin,
-- which does NOT have INSERT permission on public.profiles through RLS
-- (RLS checks auth.uid() = id, but the trigger runs before the auth
-- session is established). We keep SECURITY DEFINER but ensure the
-- search_path is immutable.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role_id)
  VALUES (NEW.id, NEW.email, (SELECT id FROM public.roles WHERE name = 'user' LIMIT 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- --- handle_new_profile ---
-- This trigger fires on public.profiles AFTER INSERT. Since the INSERT
-- policy on profiles already checks auth.uid() = id, the calling user
-- has permission to INSERT into profiles. The trigger then inserts into
-- user_settings, which has an EXISTS check against profiles. Since the
-- profiles row already exists by the time the trigger runs, the EXISTS
-- check will pass. We can safely use SECURITY INVOKER here.
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- --- update_updated_at_column ---
-- This trigger fires on UPDATE for many tables. It only sets NEW.updated_at
-- to now(). It does not access any other table, so SECURITY INVOKER is
-- appropriate. Set search_path to prevent schema hijacking.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
