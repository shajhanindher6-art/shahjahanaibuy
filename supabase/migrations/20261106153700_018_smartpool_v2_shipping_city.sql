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
--
-- SECTION 21–25 GUARD (I-P1-3): applied status is UNKNOWN — only
-- the owner can check schema_migrations, and the repo cannot
-- prove whether this file (or the standalone owner file
-- supabase/add-smartpools.sql that creates `pools`) was ever run.
-- The DO block below is the safe choice either way: when `pools`
-- was never created it no-ops with a NOTICE instead of failing
-- outright on `relation "pools" does not exist`; when the file
-- was already applied, ADD COLUMN IF NOT EXISTS is a no-op the
-- same way. The old trailing verification SELECT is replaced by
-- the NOTICE inside the block, because the SELECT itself would
-- fail on a database without the `pools` table.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.pools') IS NOT NULL THEN
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS shipping_estimate_usd numeric(12, 2);
    ALTER TABLE pools ADD COLUMN IF NOT EXISTS city text;
    RAISE NOTICE '018: pools.shipping_estimate_usd + pools.city present.';
  ELSE
    RAISE NOTICE '018: skipped — public.pools does not exist (run supabase/add-smartpools.sql first, then re-run this file).';
  END IF;
END $$;
