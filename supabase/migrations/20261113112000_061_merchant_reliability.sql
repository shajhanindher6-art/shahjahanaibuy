-- 061 — merchant_reliability table (Sections 21–25, Stage I).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, merchant-reliability
-- scores stay computed at read time and never persisted — the two
-- scorers (services/merchant-reliability.ts, policy/directory
-- score; services/merchant-reliability-score.ts, sync-history
-- score) keep returning their in-memory results exactly as today,
-- and no surface reads this table.
--
-- APPLY ORDER: only after the 035–058 backlog clears in numeric
-- order (audit §9 runbook: 045 → 047 → 048–050 → 051 → 052 →
-- 054 + 056 → 057 → 058, then 059–062). Depends on `merchants`
-- (migration 005) only. NEVER apply 035, and this file does not
-- depend on 035 or 053 (053 is dead without 035 and stays dead).
--
--   * One durable row per merchant: UNIQUE (merchant_id).
--     Scores are refreshed in place (UPSERT on merchant_id),
--     never appended — a merchant's reliability is a current
--     snapshot, not a ledger. `computed_at` says when the
--     snapshot was taken; a reader MUST treat a score as stale
--     when it predates the merchant's last sync.
--   * `score` (integer, nullable, 0–100) + `level` ('high' |
--     'medium' | 'low' | 'unknown') + `status` ('scored' |
--     'insufficient-data'): the durable form of the scorer
--     outputs. NULL score + status 'insufficient-data' is the
--     honest state when there is not enough data to score a
--     merchant — a score is never invented for a merchant with
--     no listings and no sync history. (Both scorers already
--     return score null in that case; this table stores that
--     null, it does not hide it.)
--   * `signals` (jsonb, default '[]'): the per-signal breakdown
--     (key / contributed / points) exactly as the scorer
--     returns it, so the admin surface can explain a score
--     without recomputing. `explanation` is the scorer's
--     plain-language sentence, stored verbatim.
--   * NO BACKFILL: no score is computed or written here. Both
--     scorers have zero production callers today (audit §1A A-7),
--     so there is no computed score to persist — the first real
--     scorer run after apply writes the rows.
--   * RLS is enabled. Writes are service-role-only: there is NO
--     anon/authenticated INSERT, UPDATE or DELETE policy, so rows
--     are written only through the service-role client (the same
--     pattern as price_refresh_runs, migration 040, error_log,
--     migration 048, and digest_failures, migration 050).
--     Admins may SELECT through the existing is_admin() function
--     (017); no other role reads the table.

CREATE TABLE IF NOT EXISTS public.merchant_reliability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  score integer NULL DEFAULT NULL
    CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  level text NULL DEFAULT NULL
    CHECK (level IS NULL OR level IN ('high', 'medium', 'low', 'unknown')),
  status text NOT NULL DEFAULT 'insufficient-data'
    CHECK (status IN ('scored', 'insufficient-data')),
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation text NULL DEFAULT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id)
);

-- Admin reads: scored merchants first, newest snapshot first.
CREATE INDEX IF NOT EXISTS idx_merchant_reliability_score
  ON public.merchant_reliability (score DESC, computed_at DESC)
  WHERE status = 'scored';

ALTER TABLE public.merchant_reliability ENABLE ROW LEVEL SECURITY;

-- Admin read only, via the existing is_admin() pattern (017).
-- No anon/authenticated INSERT, UPDATE or DELETE policy exists:
-- rows are written only through the service-role client.
DROP POLICY IF EXISTS "merchant_reliability_select_admin" ON public.merchant_reliability;
CREATE POLICY "merchant_reliability_select_admin" ON public.merchant_reliability
  FOR SELECT TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.merchant_reliability IS
  'Sections 21–25 (061): durable per-merchant reliability snapshot (one row per merchant, refreshed in place). NULL score + insufficient-data = not enough data to score, never invented. DO NOT APPLY YET — owner step.';
