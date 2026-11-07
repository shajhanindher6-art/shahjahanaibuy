-- ============================================================
-- 018 — SmartPools 2.0 (Option 11, Phase 3): shared shipping
-- estimate + city on pools
-- ============================================================
-- WHAT THIS DOES: adds two OPTIONAL columns to the pools table
-- (created by supabase/add-smartpools.sql, repaired by
-- supabase/repair-community-pools-columns.sql):
--   shipping_estimate_usd numeric(12,2) — the pool creator's
--     estimate of the total international shipping for the pool's
--     region/city, in USD. NULL means "no estimate supplied".
--     It is a user-supplied estimate ONLY (same convention as the
--     Option 11 landed-cost calculator, where shipping is 0 when
--     unknown): SmartBuy has no carrier rate and never invents one.
--   city text — the optional city the pool's members share, so a
--     pool can be scoped to a region AND a city. NULL means the
--     pool is region-scoped only.
--
-- HONESTY: neither column promises anything. The shipping split UI
-- divides the stored estimate evenly across real members; with no
-- estimate it renders "No shipping estimate available" — never a
-- made-up rate, cost, or carrier. Milestones never promise a
-- discount (see services/smartpool.ts).
--
-- OWNER STEP: run this file ONCE in the Supabase SQL Editor.
-- SAFE TO RUN on a healthy database too: ADD COLUMN IF NOT EXISTS
-- leaves existing columns untouched. The site does NOT depend on
-- these columns: until this runs, the API returns null for both
-- and the UI degrades to the honest empty states (never a crash,
-- never fake data).
-- ============================================================

ALTER TABLE pools ADD COLUMN IF NOT EXISTS shipping_estimate_usd numeric(12, 2);
ALTER TABLE pools ADD COLUMN IF NOT EXISTS city text;

-- Verify (the SQL editor shows only this last result):
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pools'
  AND column_name IN ('shipping_estimate_usd', 'city')
ORDER BY column_name;
