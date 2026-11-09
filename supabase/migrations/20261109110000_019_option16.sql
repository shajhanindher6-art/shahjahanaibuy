-- Migration 019: Option 16 — Repairability & Tech Budget support
--
-- CORRECTIONS vs the original spec (see audit 2026-11-09):
-- 1. `spare_parts_availability TEXT` was replaced by
--    `spare_parts_years NUMERIC`: the repairability index formula needs a
--    NUMBER of years (index = score*8 + years*2). A TEXT 'High' cannot
--    feed that formula. The High/Medium/Low label is derived from the
--    years in code instead (see services/repairability.ts).
-- 2. NO DEFAULTS (spec said repairability_score DEFAULT 7.0,
--    availability DEFAULT 'High', risk DEFAULT 'Low'). A default would
--    show every product as repairable with a real-looking score before
--    anyone recorded real data — invented data. Columns are NULL until
--    real values are recorded per product; the UI then shows an honest
--    "Not recorded yet" state instead of a fake score.
-- 3. `user_tech_budgets` policy now has WITH CHECK as well as USING:
--    WITHOUT it, INSERTs are not covered by the row check.
--
-- Owner step: run this file in Supabase (SQL Editor) after 017/018.
-- Until then every Option 16 read is fail-safe: the API returns nulls
-- and the UI shows honest empty states — nothing breaks live.

-- 1. Repairability columns on products (all NULL until real data exists).
ALTER TABLE products
ADD COLUMN IF NOT EXISTS repairability_score NUMERIC(3,1),
ADD COLUMN IF NOT EXISTS spare_parts_years NUMERIC(4,1),
ADD COLUMN IF NOT EXISTS local_repair_risk_level TEXT;

-- Repairability score is a 0–10 scale; spare-parts years cannot be negative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_repairability_score_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_repairability_score_check
      CHECK (repairability_score IS NULL OR (repairability_score >= 0 AND repairability_score <= 10));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_spare_parts_years_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_spare_parts_years_check
      CHECK (spare_parts_years IS NULL OR spare_parts_years >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_local_repair_risk_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_local_repair_risk_check
      CHECK (local_repair_risk_level IS NULL OR local_repair_risk_level IN ('Low', 'Medium', 'High'));
  END IF;
END $$;

-- 2. One tech budget per user.
CREATE TABLE IF NOT EXISTS user_tech_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    monthly_tech_budget NUMERIC DEFAULT 1000.00,
    daily_target_hours NUMERIC DEFAULT 6.0,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE user_tech_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own tech budget" ON user_tech_budgets;
CREATE POLICY "Users can manage their own tech budget"
ON user_tech_budgets
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
