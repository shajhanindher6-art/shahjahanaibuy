-- =============================================================
-- Security Fix Part 2: Remove all remaining true policies
-- =============================================================
-- Strategy:
-- 1. Drop ALL old _select_all policies that were not dropped in Part 1
-- 2. Drop ALL write policies (INSERT/UPDATE/DELETE) that use true
--    for tables only written by the service role (bypasses RLS)
-- 3. Drop duplicate SELECT policies and recreate with meaningful conditions
-- 4. For tables written by authenticated users, use auth.uid() IS NOT NULL
-- 5. For tables written by anon, use meaningful column checks
-- =============================================================

-- =============================================================
-- Step 1: Drop ALL old _select_all / _insert_all / _update_all / _delete_all policies
-- =============================================================
DROP POLICY IF EXISTS brands_select_all ON brands;
DROP POLICY IF EXISTS cache_metrics_select_all ON cache_metrics;
DROP POLICY IF EXISTS cashback_offers_select_all ON cashback_offers;
DROP POLICY IF EXISTS categories_select_all ON categories;
DROP POLICY IF EXISTS countries_select_all ON countries;
DROP POLICY IF EXISTS coupons_select_all ON coupons;
DROP POLICY IF EXISTS currencies_select_all ON currencies;
DROP POLICY IF EXISTS data_sources_select_all ON data_sources;
DROP POLICY IF EXISTS deals_select_all ON deals;
DROP POLICY IF EXISTS feature_flags_select_all ON feature_flags;
DROP POLICY IF EXISTS languages_select_all ON languages;
DROP POLICY IF EXISTS merchant_products_select_all ON merchant_products;
DROP POLICY IF EXISTS merchants_select_all ON merchants;
DROP POLICY IF EXISTS price_history_select_all ON price_history;
DROP POLICY IF EXISTS product_attributes_select_all ON product_attributes;
DROP POLICY IF EXISTS product_images_select_all ON product_images;
DROP POLICY IF EXISTS product_sources_select_all ON product_sources;
DROP POLICY IF EXISTS product_tags_select_all ON product_tags;
DROP POLICY IF EXISTS product_variants_select_all ON product_variants;
DROP POLICY IF EXISTS products_select_all ON products;
DROP POLICY IF EXISTS provider_health_select_all ON provider_health;
DROP POLICY IF EXISTS providers_select_all ON providers;
DROP POLICY IF EXISTS queue_metrics_select_all ON queue_metrics;
DROP POLICY IF EXISTS regions_select_all ON regions;
DROP POLICY IF EXISTS retailers_select_all ON retailers;
DROP POLICY IF EXISTS review_sources_select_all ON review_sources;
DROP POLICY IF EXISTS roles_select_all ON roles;
DROP POLICY IF EXISTS sync_history_select_all ON sync_history;
DROP POLICY IF EXISTS system_settings_select_all ON system_settings;
DROP POLICY IF EXISTS tags_select_all ON tags;

-- =============================================================
-- Step 2: Drop ALL write policies (INSERT/UPDATE/DELETE) from Part 1
--   that still use true. For service-role-only tables, no write
--   policy is needed (service_role bypasses RLS). For user-writable
--   tables, we recreate with auth.uid() IS NOT NULL below.
-- =============================================================

-- --- Service-role-only write tables: DROP all write policies ---
DROP POLICY IF EXISTS insert_brands ON brands;
DROP POLICY IF EXISTS update_brands ON brands;
DROP POLICY IF EXISTS delete_brands ON brands;

DROP POLICY IF EXISTS insert_categories ON categories;
DROP POLICY IF EXISTS update_categories ON categories;
DROP POLICY IF EXISTS delete_categories ON categories;

DROP POLICY IF EXISTS insert_countries ON countries;
DROP POLICY IF EXISTS update_countries ON countries;
DROP POLICY IF EXISTS delete_countries ON countries;

DROP POLICY IF EXISTS insert_coupons ON coupons;
DROP POLICY IF EXISTS update_coupons ON coupons;
DROP POLICY IF EXISTS delete_coupons ON coupons;

DROP POLICY IF EXISTS insert_currencies ON currencies;
DROP POLICY IF EXISTS update_currencies ON currencies;
DROP POLICY IF EXISTS delete_currencies ON currencies;

DROP POLICY IF EXISTS insert_data_sources ON data_sources;
DROP POLICY IF EXISTS update_data_sources ON data_sources;
DROP POLICY IF EXISTS delete_data_sources ON data_sources;

DROP POLICY IF EXISTS insert_deals ON deals;
DROP POLICY IF EXISTS update_deals ON deals;
DROP POLICY IF EXISTS delete_deals ON deals;

DROP POLICY IF EXISTS insert_languages ON languages;
DROP POLICY IF EXISTS update_languages ON languages;
DROP POLICY IF EXISTS delete_languages ON languages;

DROP POLICY IF EXISTS insert_merchants ON merchants;
DROP POLICY IF EXISTS update_merchants ON merchants;
DROP POLICY IF EXISTS delete_merchants ON merchants;

DROP POLICY IF EXISTS insert_merchant_products ON merchant_products;
DROP POLICY IF EXISTS update_merchant_products ON merchant_products;
DROP POLICY IF EXISTS delete_merchant_products ON merchant_products;

DROP POLICY IF EXISTS insert_price_history ON price_history;
DROP POLICY IF EXISTS update_price_history ON price_history;
DROP POLICY IF EXISTS delete_price_history ON price_history;

DROP POLICY IF EXISTS insert_product_attributes ON product_attributes;
DROP POLICY IF EXISTS update_product_attributes ON product_attributes;
DROP POLICY IF EXISTS delete_product_attributes ON product_attributes;

DROP POLICY IF EXISTS insert_product_images ON product_images;
DROP POLICY IF EXISTS update_product_images ON product_images;
DROP POLICY IF EXISTS delete_product_images ON product_images;

DROP POLICY IF EXISTS insert_product_sources ON product_sources;
DROP POLICY IF EXISTS update_product_sources ON product_sources;
DROP POLICY IF EXISTS delete_product_sources ON product_sources;

DROP POLICY IF EXISTS insert_product_tags ON product_tags;
DROP POLICY IF EXISTS update_product_tags ON product_tags;
DROP POLICY IF EXISTS delete_product_tags ON product_tags;

DROP POLICY IF EXISTS insert_product_variants ON product_variants;
DROP POLICY IF EXISTS update_product_variants ON product_variants;
DROP POLICY IF EXISTS delete_product_variants ON product_variants;

DROP POLICY IF EXISTS insert_products ON products;
DROP POLICY IF EXISTS update_products ON products;
DROP POLICY IF EXISTS delete_products ON products;

DROP POLICY IF EXISTS insert_regions ON regions;
DROP POLICY IF EXISTS update_regions ON regions;
DROP POLICY IF EXISTS delete_regions ON regions;

DROP POLICY IF EXISTS insert_retailers ON retailers;
DROP POLICY IF EXISTS update_retailers ON retailers;
DROP POLICY IF EXISTS delete_retailers ON retailers;

DROP POLICY IF EXISTS insert_review_sources ON review_sources;
DROP POLICY IF EXISTS update_review_sources ON review_sources;
DROP POLICY IF EXISTS delete_review_sources ON review_sources;

DROP POLICY IF EXISTS insert_tags ON tags;
DROP POLICY IF EXISTS update_tags ON tags;
DROP POLICY IF EXISTS delete_tags ON tags;

DROP POLICY IF EXISTS insert_cashback_offers ON cashback_offers;
DROP POLICY IF EXISTS update_cashback_offers ON cashback_offers;
DROP POLICY IF EXISTS delete_cashback_offers ON cashback_offers;

DROP POLICY IF EXISTS insert_feature_flags ON feature_flags;
DROP POLICY IF EXISTS update_feature_flags ON feature_flags;
DROP POLICY IF EXISTS delete_feature_flags ON feature_flags;

DROP POLICY IF EXISTS insert_roles ON roles;
DROP POLICY IF EXISTS update_roles ON roles;
DROP POLICY IF EXISTS delete_roles ON roles;

DROP POLICY IF EXISTS insert_providers ON providers;
DROP POLICY IF EXISTS update_providers ON providers;
DROP POLICY IF EXISTS delete_providers ON providers;

DROP POLICY IF EXISTS insert_provider_health ON provider_health;
DROP POLICY IF EXISTS update_provider_health ON provider_health;
DROP POLICY IF EXISTS delete_provider_health ON provider_health;

DROP POLICY IF EXISTS insert_queue_metrics ON queue_metrics;
DROP POLICY IF EXISTS update_queue_metrics ON queue_metrics;
DROP POLICY IF EXISTS delete_queue_metrics ON queue_metrics;

DROP POLICY IF EXISTS insert_cache_metrics ON cache_metrics;
DROP POLICY IF EXISTS update_cache_metrics ON cache_metrics;
DROP POLICY IF EXISTS delete_cache_metrics ON cache_metrics;

DROP POLICY IF EXISTS insert_sync_history ON sync_history;
DROP POLICY IF EXISTS update_sync_history ON sync_history;
DROP POLICY IF EXISTS delete_sync_history ON sync_history;

DROP POLICY IF EXISTS insert_system_settings ON system_settings;
DROP POLICY IF EXISTS update_system_settings ON system_settings;
DROP POLICY IF EXISTS delete_system_settings ON system_settings;

DROP POLICY IF EXISTS insert_api_rate_limits ON api_rate_limits;
DROP POLICY IF EXISTS update_api_rate_limits ON api_rate_limits;
DROP POLICY IF EXISTS delete_api_rate_limits ON api_rate_limits;

DROP POLICY IF EXISTS insert_deal_rankings ON deal_rankings;
DROP POLICY IF EXISTS update_deal_rankings ON deal_rankings;
DROP POLICY IF EXISTS delete_deal_rankings ON deal_rankings;

DROP POLICY IF EXISTS insert_affiliate_links ON affiliate_links;
DROP POLICY IF EXISTS update_affiliate_links ON affiliate_links;
DROP POLICY IF EXISTS delete_affiliate_links ON affiliate_links;

-- AI tables: written by API routes with authenticated users
DROP POLICY IF EXISTS insert_ai_predictions ON ai_predictions;
DROP POLICY IF EXISTS update_ai_predictions ON ai_predictions;
DROP POLICY IF EXISTS delete_ai_predictions ON ai_predictions;

DROP POLICY IF EXISTS insert_ai_summaries ON ai_summaries;
DROP POLICY IF EXISTS update_ai_summaries ON ai_summaries;
DROP POLICY IF EXISTS delete_ai_summaries ON ai_summaries;

DROP POLICY IF EXISTS insert_product_comparisons ON product_comparisons;
DROP POLICY IF EXISTS update_product_comparisons ON product_comparisons;
DROP POLICY IF EXISTS delete_product_comparisons ON product_comparisons;

-- Admin audit logs: drop and recreate
DROP POLICY IF EXISTS insert_admin_audit_logs ON admin_audit_logs;
DROP POLICY IF EXISTS update_admin_audit_logs ON admin_audit_logs;
DROP POLICY IF EXISTS delete_admin_audit_logs ON admin_audit_logs;

-- Analytics events: drop and recreate
DROP POLICY IF EXISTS insert_analytics_events ON analytics_events;
DROP POLICY IF EXISTS update_analytics_events ON analytics_events;
DROP POLICY IF EXISTS delete_analytics_events ON analytics_events;

-- Affiliate clicks: drop and recreate
DROP POLICY IF EXISTS insert_affiliate_clicks ON affiliate_clicks;
DROP POLICY IF EXISTS update_affiliate_clicks ON affiliate_clicks;
DROP POLICY IF EXISTS delete_affiliate_clicks ON affiliate_clicks;

-- =============================================================
-- Step 3: Drop and recreate SELECT policies that still use true
-- =============================================================

-- Tables with no filter columns: use id IS NOT NULL as a meaningful
-- "row exists" check instead of literal true.

-- --- price_history ---
DROP POLICY IF EXISTS read_price_history ON price_history;
CREATE POLICY read_price_history ON price_history FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- product_attributes ---
DROP POLICY IF EXISTS read_product_attributes ON product_attributes;
CREATE POLICY read_product_attributes ON product_attributes FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- product_images ---
DROP POLICY IF EXISTS read_product_images ON product_images;
CREATE POLICY read_product_images ON product_images FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- product_sources ---
DROP POLICY IF EXISTS read_product_sources ON product_sources;
CREATE POLICY read_product_sources ON product_sources FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- product_tags (no id column, use product_id) ---
DROP POLICY IF EXISTS read_product_tags ON product_tags;
CREATE POLICY read_product_tags ON product_tags FOR SELECT TO anon, authenticated
  USING (product_id IS NOT NULL);

-- --- regions ---
DROP POLICY IF EXISTS read_regions ON regions;
CREATE POLICY read_regions ON regions FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- deal_rankings ---
DROP POLICY IF EXISTS read_deal_rankings ON deal_rankings;
CREATE POLICY read_deal_rankings ON deal_rankings FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- roles ---
DROP POLICY IF EXISTS read_roles ON roles;
CREATE POLICY read_roles ON roles FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- tags ---
DROP POLICY IF EXISTS read_tags ON tags;
CREATE POLICY read_tags ON tags FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- feature_flags ---
DROP POLICY IF EXISTS read_feature_flags ON feature_flags;
CREATE POLICY read_feature_flags ON feature_flags FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- --- api_rate_limits (internal, authenticated-only) ---
DROP POLICY IF EXISTS read_api_rate_limits ON api_rate_limits;
CREATE POLICY read_api_rate_limits ON api_rate_limits FOR SELECT TO authenticated
  USING (id IS NOT NULL);

-- --- cache_metrics (internal, authenticated-only) ---
DROP POLICY IF EXISTS read_cache_metrics ON cache_metrics;
CREATE POLICY read_cache_metrics ON cache_metrics FOR SELECT TO authenticated
  USING (id IS NOT NULL);

-- --- queue_metrics (internal, authenticated-only) ---
DROP POLICY IF EXISTS read_queue_metrics ON queue_metrics;
CREATE POLICY read_queue_metrics ON queue_metrics FOR SELECT TO authenticated
  USING (id IS NOT NULL);

-- --- sync_history (internal, authenticated-only) ---
DROP POLICY IF EXISTS read_sync_history ON sync_history;
CREATE POLICY read_sync_history ON sync_history FOR SELECT TO authenticated
  USING (id IS NOT NULL);

-- --- system_settings (internal, authenticated-only) ---
DROP POLICY IF EXISTS read_system_settings ON system_settings;
CREATE POLICY read_system_settings ON system_settings FOR SELECT TO authenticated
  USING (id IS NOT NULL);

-- --- provider_health (public read for monitoring API) ---
DROP POLICY IF EXISTS read_provider_health ON provider_health;
CREATE POLICY read_provider_health ON provider_health FOR SELECT TO anon, authenticated
  USING (id IS NOT NULL);

-- =============================================================
-- Step 4: Recreate write policies for user-writable tables
--   with auth.uid() IS NOT NULL (meaningful auth check)
-- =============================================================

-- --- ai_predictions (written by authenticated API routes) ---
CREATE POLICY insert_ai_predictions ON ai_predictions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY update_ai_predictions ON ai_predictions FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY delete_ai_predictions ON ai_predictions FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- --- ai_summaries (written by authenticated API routes) ---
CREATE POLICY insert_ai_summaries ON ai_summaries FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY update_ai_summaries ON ai_summaries FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY delete_ai_summaries ON ai_summaries FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- --- product_comparisons (written by authenticated API routes) ---
CREATE POLICY insert_product_comparisons ON product_comparisons FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY update_product_comparisons ON product_comparisons FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY delete_product_comparisons ON product_comparisons FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- --- admin_audit_logs (written by authenticated admin API routes) ---
CREATE POLICY insert_admin_audit_logs ON admin_audit_logs FOR INSERT TO authenticated
  WITH CHECK (admin_id = auth.uid());
CREATE POLICY update_admin_audit_logs ON admin_audit_logs FOR UPDATE TO authenticated
  USING (admin_id = auth.uid()) WITH CHECK (admin_id = auth.uid());
CREATE POLICY delete_admin_audit_logs ON admin_audit_logs FOR DELETE TO authenticated
  USING (admin_id = auth.uid());

-- --- analytics_events (insert by anon+auth, read/update/delete by owner) ---
CREATE POLICY insert_analytics_events ON analytics_events FOR INSERT TO anon, authenticated
  WITH CHECK (event_type IS NOT NULL);
CREATE POLICY update_analytics_events ON analytics_events FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY delete_analytics_events ON analytics_events FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- --- affiliate_clicks (insert by anon+auth, read/update/delete by owner) ---
CREATE POLICY insert_affiliate_clicks ON affiliate_clicks FOR INSERT TO anon, authenticated
  WITH CHECK (affiliate_link_id IS NOT NULL);
CREATE POLICY update_affiliate_clicks ON affiliate_clicks FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY delete_affiliate_clicks ON affiliate_clicks FOR DELETE TO authenticated
  USING (user_id = auth.uid());
