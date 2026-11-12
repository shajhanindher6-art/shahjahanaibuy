-- 041 — eBay daily usage counter (Section 15, P3-5 + P3-7).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. The eBay daily-budget guard (services/ebay-budget.ts)
-- already handles a missing table honestly: until this migration is
-- applied, the counter falls back to Upstash Redis when configured,
-- and fails open (allows the call, logs a warning) when neither
-- Redis nor this table is available. Applying the migration is an
-- OWNER step (run once in the Supabase dashboard SQL editor).
--
--   * ebay_daily_usage stores ONE row per UTC date: how many eBay
--     Browse calls were spent that day. The counter is global, not
--     per user and not per IP — the 5,000/day free tier is shared
--     by every caller (public search, admin preview, refresh).
--   * The cap itself lives in code (EBAY_DAILY_BUDGET_CAP = 4,500,
--     90% of the free tier — see services/ebay-budget.ts), not in
--     the schema, so the headroom can change without a migration.
--   * `calls` is NULL-defaulted to 0 and CHECKed >= 0. `updated_at`
--     is NULL until the first increment after insert.
--   * RLS is enabled. There is NO anon/authenticated INSERT,
--     UPDATE or SELECT policy, so the counter is written and read
--     only through the service-role client. The count is
--     operational metadata (a number per day, no user data), but
--     there is no public read path for it — the admin UI reads it
--     through the admin-only preview route, which uses the
--     service-role client.
--   * No cache table is created here: the Browse search cache is
--     memory-only by design (see the audit, Chunk 8), so no
--     migration is needed for it.

CREATE TABLE IF NOT EXISTS public.ebay_daily_usage (
  usage_date date PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  updated_at timestamptz NULL DEFAULT NULL
);

ALTER TABLE public.ebay_daily_usage ENABLE ROW LEVEL SECURITY;

-- No policies are created on purpose: only the service-role client
-- (which bypasses RLS) may read or write this table. Any future
-- SELECT policy must be added deliberately, never by default.
