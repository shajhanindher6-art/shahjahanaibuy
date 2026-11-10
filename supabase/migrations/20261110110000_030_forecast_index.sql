-- Migration 030: S5#4 probabilistic forecasting, S5#5 SmartBuy Price
-- Index, S5#6 market reports.
--
-- These are PUBLIC AGGREGATE / SYSTEM tables, not user-owned rows:
-- forecasts, backtests, index snapshots and reports are computed
-- from recorded price history by the server and read by everyone.
-- There is therefore no per-row owner column (nothing here belongs
-- to one user); writes are admin-only via public.is_admin()
-- (created in migration 017), exactly like the other system tables
-- in 017. SELECT is public: the index and the reports are public
-- content by design. Dedupe UNIQUEs on every table stop duplicate
-- snapshots for the same product / horizon / day or category /
-- region / month.
--
-- NOTHING here stores a price, a forecast, or a report figure that
-- was invented: rows are snapshots of values computed from recorded
-- `price_history` rows (see lib/forecast.ts, lib/price-index.ts,
-- lib/market-reports.ts). All value columns are NULL by default
-- where "not recorded / not computable" is a real state
-- (index_value, accuracy_pct). The API routes compute live and
-- fail-safe to honest empty states when these tables do not exist
-- yet, so this migration is not a launch blocker.

-- ---------------------------------------------------------------------------
-- price_forecasts: one stored forecast range per product / horizon / day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  horizon_days int NOT NULL CHECK (horizon_days IN (7, 30, 90)),
  forecast_low numeric(12, 2) NOT NULL CHECK (forecast_low > 0),
  forecast_high numeric(12, 2) NOT NULL CHECK (forecast_high > forecast_low),
  central numeric(12, 2) NOT NULL CHECK (central > 0),
  confidence_pct int NOT NULL CHECK (confidence_pct >= 0 AND confidence_pct <= 100),
  points_used int NOT NULL DEFAULT 0 CHECK (points_used >= 0),
  forecast_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, horizon_days, forecast_date)
);

CREATE INDEX IF NOT EXISTS price_forecasts_product_idx
  ON price_forecasts(product_id, forecast_date DESC);

ALTER TABLE price_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_forecasts_select_all" ON price_forecasts;
CREATE POLICY "price_forecasts_select_all" ON price_forecasts FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "price_forecasts_insert_admin" ON price_forecasts;
CREATE POLICY "price_forecasts_insert_admin" ON price_forecasts FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "price_forecasts_update_admin" ON price_forecasts;
CREATE POLICY "price_forecasts_update_admin" ON price_forecasts FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "price_forecasts_delete_admin" ON price_forecasts;
CREATE POLICY "price_forecasts_delete_admin" ON price_forecasts FOR DELETE
  TO authenticated USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- forecast_backtests: one stored backtest run per product / horizon / day.
-- accuracy_pct is NULL when the run had zero trials — never a
-- fabricated percentage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forecast_backtests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  horizon_days int NOT NULL CHECK (horizon_days IN (7, 30, 90)),
  trials int NOT NULL DEFAULT 0 CHECK (trials >= 0),
  hits int NOT NULL DEFAULT 0 CHECK (hits >= 0 AND hits <= trials),
  accuracy_pct numeric(5, 2) DEFAULT NULL CHECK (accuracy_pct IS NULL OR (accuracy_pct >= 0 AND accuracy_pct <= 100)),
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, horizon_days, run_date)
);

CREATE INDEX IF NOT EXISTS forecast_backtests_product_idx
  ON forecast_backtests(product_id, run_date DESC);

ALTER TABLE forecast_backtests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "forecast_backtests_select_all" ON forecast_backtests;
CREATE POLICY "forecast_backtests_select_all" ON forecast_backtests FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "forecast_backtests_insert_admin" ON forecast_backtests;
CREATE POLICY "forecast_backtests_insert_admin" ON forecast_backtests FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "forecast_backtests_update_admin" ON forecast_backtests;
CREATE POLICY "forecast_backtests_update_admin" ON forecast_backtests FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "forecast_backtests_delete_admin" ON forecast_backtests;
CREATE POLICY "forecast_backtests_delete_admin" ON forecast_backtests FOR DELETE
  TO authenticated USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- price_index_snapshots: one stored monthly index value per
-- category / region / month. region 'GLOBAL' = all regions pooled.
-- index_value NULL + status 'insufficient' = not enough recorded
-- prices for a publishable value (never a fabricated number).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_index_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  region text NOT NULL DEFAULT 'GLOBAL',
  period_month text NOT NULL CHECK (period_month ~ '^[0-9]{4}-[0-9]{2}$'),
  index_value numeric(10, 2) DEFAULT NULL,
  products_used int NOT NULL DEFAULT 0 CHECK (products_used >= 0),
  points_used int NOT NULL DEFAULT 0 CHECK (points_used >= 0),
  status text NOT NULL DEFAULT 'insufficient' CHECK (status IN ('ok', 'insufficient')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, region, period_month)
);

CREATE INDEX IF NOT EXISTS price_index_snapshots_month_idx
  ON price_index_snapshots(period_month DESC, category, region);

ALTER TABLE price_index_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_index_snapshots_select_all" ON price_index_snapshots;
CREATE POLICY "price_index_snapshots_select_all" ON price_index_snapshots FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "price_index_snapshots_insert_admin" ON price_index_snapshots;
CREATE POLICY "price_index_snapshots_insert_admin" ON price_index_snapshots FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "price_index_snapshots_update_admin" ON price_index_snapshots;
CREATE POLICY "price_index_snapshots_update_admin" ON price_index_snapshots FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "price_index_snapshots_delete_admin" ON price_index_snapshots;
CREATE POLICY "price_index_snapshots_delete_admin" ON price_index_snapshots FOR DELETE
  TO authenticated USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- market_reports: published reports (weekly deal report, monthly
-- category deep-dive, seasonal guide). body holds the generated
-- findings (JSON, built only from recorded data — see
-- lib/market-reports.ts). A row is public only once published_at
-- is set; drafts (published_at NULL) are admin-visible only.
-- created_by is the publishing admin, or NULL for system-generated
-- reports. slug is unique so /market-reports can address a report
-- by slug once per-report pages exist (wave 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('weekly-deal-report', 'monthly-deep-dive', 'seasonal-guide')),
  title text NOT NULL,
  period_label text NOT NULL,
  category text DEFAULT NULL,
  region text NOT NULL DEFAULT 'GLOBAL',
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_quality text NOT NULL DEFAULT 'insufficient' CHECK (data_quality IN ('sufficient', 'thin', 'insufficient')),
  products_used int NOT NULL DEFAULT 0 CHECK (products_used >= 0),
  points_used int NOT NULL DEFAULT 0 CHECK (points_used >= 0),
  history_days int NOT NULL DEFAULT 0 CHECK (history_days >= 0),
  published_at timestamptz DEFAULT NULL,
  created_by uuid DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_reports_published_idx
  ON market_reports(published_at DESC, kind) WHERE published_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_reports_kind_idx
  ON market_reports(kind, period_label DESC);

ALTER TABLE market_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "market_reports_select_published" ON market_reports;
CREATE POLICY "market_reports_select_published" ON market_reports FOR SELECT
  TO anon, authenticated USING (published_at IS NOT NULL OR public.is_admin());
DROP POLICY IF EXISTS "market_reports_insert_admin" ON market_reports;
CREATE POLICY "market_reports_insert_admin" ON market_reports FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "market_reports_update_admin" ON market_reports;
CREATE POLICY "market_reports_update_admin" ON market_reports FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "market_reports_delete_admin" ON market_reports;
CREATE POLICY "market_reports_delete_admin" ON market_reports FOR DELETE
  TO authenticated USING (public.is_admin());

NOTIFY pgrst, 'reload schema';
