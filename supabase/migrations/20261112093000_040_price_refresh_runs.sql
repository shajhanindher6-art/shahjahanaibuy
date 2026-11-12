-- 040 — Price refresh runs (Section 15, P1-5 + P1-7).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. The refresh endpoints (app/api/v1/prices/refresh and
-- app/api/v1/alerts/check) and the /status page already handle a
-- missing table honestly: until this migration is applied, refresh
-- runs proceed unguarded and unrecorded (a warning is logged, never
-- a 500), and /status keeps its "no refresh recorded yet" text.
-- Applying the migration is an OWNER step (run once in the
-- Supabase dashboard SQL editor).
--
--   * price_refresh_runs stores ONE row per refresh run: which
--     trigger started it (prices-refresh or alerts-check), when it
--     started/finished, its overall status, and a compact per-step
--     summary ({ refresh: { status }, alerts: { status, error } … }
--     in the steps jsonb column — statuses and error messages only,
--     no counts; the full counts live in the run's API response,
--     which is ephemeral by design).
--   * The row is the "run in progress" guard (P1-7): a run starts
--     by inserting a `running` row, and a second trigger that finds
--     a still-`running` row younger than 30 minutes skips its run
--     instead of duplicating the chain. A `running` row older than
--     30 minutes is a crashed run and is marked `failed` by the
--     next trigger, so it never blocks the next cadence.
--   * No UNIQUE index on price_history is added here: that index
--     requires checking the live table for existing duplicates
--     first, which cannot be done from the repo. It stays a
--     follow-up for the owner, not a silent schema change.
--   * started_at / finished_at are NULL-defaulted where a value
--     does not exist yet: finished_at is NULL while a run is in
--     progress, and a CHECK enforces finished_at >= started_at
--     once it is set. error is NULL on success.
--   * RLS is enabled. The per-step data is public operational
--     metadata (timestamps + step statuses, no user data, no
--     prices), so anon clients may SELECT it — that is how the
--     public /status page reads the latest run. There is NO
--     anon/authenticated INSERT, UPDATE or DELETE policy, so runs
--     are written only through the service-role client.

CREATE TABLE IF NOT EXISTS public.price_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'prices-refresh'
    CHECK (source IN ('prices-refresh', 'alerts-check')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL DEFAULT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'completed_with_failures', 'failed')),
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NULL DEFAULT NULL,
  CONSTRAINT price_refresh_runs_finished_after_start
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_price_refresh_runs_started
  ON public.price_refresh_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_refresh_runs_running
  ON public.price_refresh_runs (started_at DESC)
  WHERE status = 'running';

ALTER TABLE public.price_refresh_runs ENABLE ROW LEVEL SECURITY;

-- Public read of run metadata only (timestamps + step statuses).
-- The /status page reads the latest row with the anon client.
DROP POLICY IF EXISTS "price_refresh_runs_select_public" ON public.price_refresh_runs;
CREATE POLICY "price_refresh_runs_select_public" ON public.price_refresh_runs
  FOR SELECT TO anon
  USING (true);
