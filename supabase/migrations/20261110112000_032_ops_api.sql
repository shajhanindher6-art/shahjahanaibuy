-- Migration 032: Ops API — public API keys, prediction accuracy outcomes,
-- uptime checks + incidents (Section 4 items 8, 11, 13, 18).
--
-- Honesty rules enforced here, not just in code:
--   * api_keys stores ONLY the SHA-256 hash of a key, never the key
--     itself. The full key is shown to its owner exactly once, at
--     creation; it can never be read back from this table.
--   * prediction_outcomes records only what actually happened. An
--     outcome stays 'pending' until the horizon passes and a real
--     recorded price exists — no outcome is ever backfilled or guessed.
--   * uptime_checks / uptime_incidents start EMPTY. Uptime % is
--     computed from recorded checks only; before checks accrue the
--     status page says monitoring started and shows no percentage.
--   * All recorded values default to NULL where "not recorded" is the
--     honest state. No invented defaults anywhere in this file.
--
-- RLS: api_keys is owner-only (WITH CHECK, non-null owner, UNIQUE
-- key_hash). prediction_outcomes / uptime_checks / uptime_incidents
-- are public-read (their aggregates are public: accuracy %, uptime %,
-- incident history) and writable only via the service-role client —
-- no INSERT/UPDATE/DELETE policy exists for anon/authenticated, so
-- only server-side cron/admin code can write them.

-- ---------------------------------------------------------------------------
-- Public API keys (S4#18)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['products:read', 'prices:read', 'deals:read'],
  last_used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_owner_read" ON public.api_keys;
CREATE POLICY "api_keys_owner_read" ON public.api_keys
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_keys_owner_insert" ON public.api_keys;
CREATE POLICY "api_keys_owner_insert" ON public.api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_keys_owner_update" ON public.api_keys;
CREATE POLICY "api_keys_owner_update" ON public.api_keys
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "api_keys_owner_delete" ON public.api_keys;
CREATE POLICY "api_keys_owner_delete" ON public.api_keys
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON public.api_keys (user_id);
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON public.api_keys (key_hash);

-- ---------------------------------------------------------------------------
-- Prediction accuracy outcomes (S4#8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prediction_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  prediction_id UUID NULL REFERENCES public.ai_predictions(id) ON DELETE SET NULL,
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  horizon_days INT NOT NULL DEFAULT 30 CHECK (horizon_days > 0),
  discount_probability NUMERIC NOT NULL CHECK (discount_probability >= 0 AND discount_probability <= 100),
  price_at_prediction NUMERIC NULL,
  predicted_lowest_price NUMERIC NULL,
  actual_lowest_price NUMERIC NULL,
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'correct', 'incorrect', 'expired')),
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;

-- Public read: the accuracy dashboard shows aggregates of this table.
DROP POLICY IF EXISTS "prediction_outcomes_public_read" ON public.prediction_outcomes;
CREATE POLICY "prediction_outcomes_public_read" ON public.prediction_outcomes
  FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policy: only the service-role client
-- (cron/admin recorder) writes outcomes.

-- One outcome per product, horizon and calendar day — the recorder
-- upserts against this instead of inserting duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS prediction_outcomes_dedupe_idx
  ON public.prediction_outcomes (product_id, horizon_days, DATE(predicted_at));

CREATE INDEX IF NOT EXISTS prediction_outcomes_product_idx
  ON public.prediction_outcomes (product_id, predicted_at DESC);
CREATE INDEX IF NOT EXISTS prediction_outcomes_outcome_idx
  ON public.prediction_outcomes (outcome);

-- ---------------------------------------------------------------------------
-- Uptime checks (S4#13) — one row per in-app check run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.uptime_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  target_url TEXT NOT NULL,
  status_code INT NULL,
  ok BOOLEAN NOT NULL,
  response_ms INT NULL,
  error TEXT NULL,
  source TEXT NOT NULL DEFAULT 'in-app'
);

ALTER TABLE public.uptime_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uptime_checks_public_read" ON public.uptime_checks;
CREATE POLICY "uptime_checks_public_read" ON public.uptime_checks
  FOR SELECT USING (true);
-- No write policy: only the service-role client (check runner) writes.

CREATE INDEX IF NOT EXISTS uptime_checks_checked_at_idx
  ON public.uptime_checks (checked_at DESC);
CREATE INDEX IF NOT EXISTS uptime_checks_target_idx
  ON public.uptime_checks (target_url, checked_at DESC);

-- ---------------------------------------------------------------------------
-- Uptime incidents (S4#11) — human-recorded, never auto-invented
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.uptime_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'investigating'
    CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.uptime_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uptime_incidents_public_read" ON public.uptime_incidents;
CREATE POLICY "uptime_incidents_public_read" ON public.uptime_incidents
  FOR SELECT USING (true);
-- No write policy: incidents are recorded by an admin (Supabase SQL
-- or admin tooling) via the service-role client, never by the app
-- inventing one from a single failed check.
