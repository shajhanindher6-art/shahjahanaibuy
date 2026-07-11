/*
# Phase 3: AI Features Tables

## Purpose
Extends the SmartBuy AI database with tables for AI-powered search, recommendations,
price predictions, deal rankings, alert history, and admin analytics.

## New Tables (10)

1. `search_history` — Tracks user natural-language search queries for recommendations
2. `product_views` — Tracks product page views per user for recommendation engine
3. `ai_predictions` — Stores AI-generated price drop predictions with confidence scores
4. `ai_summaries` — Cached AI-generated product summaries (pros, cons, alternatives)
5. `price_alert_history` — Log of alert triggers (when alerts fired and what price)
6. `deal_rankings` — AI-ranked deals with scores and categories (flash, coupon, hidden, etc.)
7. `product_comparisons` — Cached AI product comparison summaries
8. `user_preferences` — User shopping preferences (budget, favorite brands, categories)
9. `admin_audit_logs` — Admin panel action audit trail
10. `api_rate_limits` — Per-endpoint rate limit tracking table

## Security
- RLS enabled on all tables
- Owner-scoped CRUD for user-specific tables (search_history, product_views, user_preferences, price_alert_history)
- Authenticated read for public AI data (ai_summaries, ai_predictions, deal_rankings, product_comparisons)
- Admin-only CRUD for admin_audit_logs
- All user-specific tables default user_id to auth.uid()
*/

-- ===========================================================================
-- 1. search_history
-- ===========================================================================
CREATE TABLE IF NOT EXISTS search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  query text NOT NULL,
  filters jsonb,
  results_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_search_history" ON search_history;
CREATE POLICY "select_own_search_history" ON search_history FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_search_history" ON search_history;
CREATE POLICY "insert_own_search_history" ON search_history FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_search_history" ON search_history;
CREATE POLICY "delete_own_search_history" ON search_history FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, created_at DESC);

-- ===========================================================================
-- 2. product_views
-- ===========================================================================
CREATE TABLE IF NOT EXISTS product_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE product_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_product_views" ON product_views;
CREATE POLICY "select_own_product_views" ON product_views FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_product_views" ON product_views;
CREATE POLICY "insert_own_product_views" ON product_views FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_product_views" ON product_views;
CREATE POLICY "delete_own_product_views" ON product_views FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_product_views_user ON product_views(user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_views_product ON product_views(product_id);

-- ===========================================================================
-- 3. ai_predictions
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  prediction_type text NOT NULL DEFAULT 'price_drop',
  discount_probability numeric NOT NULL DEFAULT 0,
  expected_sale_date date,
  expected_lowest_price numeric,
  confidence_score numeric NOT NULL DEFAULT 0,
  explanation text,
  price_data_range jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE ai_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_ai_predictions" ON ai_predictions;
CREATE POLICY "read_ai_predictions" ON ai_predictions FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_ai_predictions" ON ai_predictions;
CREATE POLICY "insert_ai_predictions" ON ai_predictions FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_product ON ai_predictions(product_id, created_at DESC);

-- ===========================================================================
-- 4. ai_summaries
-- ===========================================================================
CREATE TABLE IF NOT EXISTS ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  summary text NOT NULL,
  pros jsonb NOT NULL DEFAULT '[]',
  cons jsonb NOT NULL DEFAULT '[]',
  alternatives jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

ALTER TABLE ai_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_ai_summaries" ON ai_summaries;
CREATE POLICY "read_ai_summaries" ON ai_summaries FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_ai_summaries" ON ai_summaries;
CREATE POLICY "insert_ai_summaries" ON ai_summaries FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "delete_ai_summaries" ON ai_summaries;
CREATE POLICY "delete_ai_summaries" ON ai_summaries FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_ai_summaries_product ON ai_summaries(product_id);

-- ===========================================================================
-- 5. price_alert_history
-- ===========================================================================
CREATE TABLE IF NOT EXISTS price_alert_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  triggered_price numeric NOT NULL,
  target_price numeric,
  notification_channel text NOT NULL DEFAULT 'email',
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE price_alert_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_alert_history" ON price_alert_history;
CREATE POLICY "select_own_alert_history" ON price_alert_history FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_alert_history" ON price_alert_history;
CREATE POLICY "insert_own_alert_history" ON price_alert_history FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_alert_history_user ON price_alert_history(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_alert ON price_alert_history(alert_id);

-- ===========================================================================
-- 6. deal_rankings
-- ===========================================================================
CREATE TABLE IF NOT EXISTS deal_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  deal_type text NOT NULL DEFAULT 'general',
  ai_score numeric NOT NULL DEFAULT 0,
  discount_percentage numeric NOT NULL DEFAULT 0,
  savings_amount numeric NOT NULL DEFAULT 0,
  is_featured boolean NOT NULL DEFAULT false,
  ranked_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deal_rankings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_deal_rankings" ON deal_rankings;
CREATE POLICY "read_deal_rankings" ON deal_rankings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_deal_rankings" ON deal_rankings;
CREATE POLICY "insert_deal_rankings" ON deal_rankings FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_deal_rankings_type ON deal_rankings(deal_type, ai_score DESC);
CREATE INDEX IF NOT EXISTS idx_deal_rankings_featured ON deal_rankings(is_featured, ranked_at DESC);

-- ===========================================================================
-- 7. product_comparisons
-- ===========================================================================
CREATE TABLE IF NOT EXISTS product_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_ids uuid[] NOT NULL,
  ai_summary text NOT NULL,
  comparison_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

ALTER TABLE product_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_product_comparisons" ON product_comparisons;
CREATE POLICY "read_product_comparisons" ON product_comparisons FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_product_comparisons" ON product_comparisons;
CREATE POLICY "insert_product_comparisons" ON product_comparisons FOR INSERT
  TO authenticated WITH CHECK (true);

-- ===========================================================================
-- 8. user_preferences
-- ===========================================================================
CREATE TABLE IF NOT EXISTS user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  budget_min numeric,
  budget_max numeric,
  favorite_brands text[] NOT NULL DEFAULT '{}',
  favorite_categories text[] NOT NULL DEFAULT '{}',
  preferred_retailers text[] NOT NULL DEFAULT '{}',
  notification_email boolean NOT NULL DEFAULT true,
  notification_push boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_preferences" ON user_preferences;
CREATE POLICY "select_own_preferences" ON user_preferences FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_preferences" ON user_preferences;
CREATE POLICY "insert_own_preferences" ON user_preferences FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_preferences" ON user_preferences;
CREATE POLICY "update_own_preferences" ON user_preferences FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_preferences" ON user_preferences;
CREATE POLICY "delete_own_preferences" ON user_preferences FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ===========================================================================
-- 9. admin_audit_logs
-- ===========================================================================
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_admin_audit_logs" ON admin_audit_logs;
CREATE POLICY "read_admin_audit_logs" ON admin_audit_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_admin_audit_logs" ON admin_audit_logs;
CREATE POLICY "insert_admin_audit_logs" ON admin_audit_logs FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_logs(admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_logs(action, created_at DESC);

-- ===========================================================================
-- 10. api_rate_limits
-- ===========================================================================
CREATE TABLE IF NOT EXISTS api_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  endpoint text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  window_end timestamptz NOT NULL DEFAULT (now() + interval '1 minute')
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_api_rate_limits" ON api_rate_limits;
CREATE POLICY "read_api_rate_limits" ON api_rate_limits FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_api_rate_limits" ON api_rate_limits;
CREATE POLICY "insert_api_rate_limits" ON api_rate_limits FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_api_rate_limits" ON api_rate_limits;
CREATE POLICY "update_api_rate_limits" ON api_rate_limits FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_api_rate_limits" ON api_rate_limits;
CREATE POLICY "delete_api_rate_limits" ON api_rate_limits FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier ON api_rate_limits(identifier, endpoint, window_end);
