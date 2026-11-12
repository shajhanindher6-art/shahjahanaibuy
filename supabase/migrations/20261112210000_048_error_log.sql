-- 048 — Application error log (Section 18, item 45; audit §1 #10).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the owner dashboard
-- renders the honest "error_log table not applied yet" empty state
-- (see services/error-log-admin.ts) instead of erroring, and no
-- error row is ever invented.
--
--   * error_log stores ONE row per recorded application error:
--     when it happened, severity level, message, the route that
--     produced it, the request id when one exists (see audit §1
--     #37 — no request ids exist yet, so request_id is NULL until
--     a request-id item lands), the user when known, and free-form
--     context in meta jsonb. It is a store, not an alerter: nothing
--     here notifies anybody (see audit §1 #10 — uptime failures
--     notify nobody automatically, by design).
--   * level is a CHECKed enum, not free text: 'debug' | 'info' |
--     'warn' | 'error' | 'critical'. DEFAULT 'error'.
--   * message is NOT NULL: a row with no message is not a log
--     entry. user_id is NULL by default — most application errors
--     have no user attached, and inventing one would be worse
--     than recording none.
--   * RLS is enabled. Writes are service-role-only: there is NO
--     anon/authenticated INSERT, UPDATE or DELETE policy, so rows
--     are written only through the service-role client (the same
--     pattern as price_refresh_runs, migration 040). Admins may
--     SELECT through the existing is_admin() function (017); no
--     other role reads the table.
--   * No retention/deletion policy is set here: rows are kept
--     until the owner decides a retention window. Deleting rows
--     is a deliberate owner action, not a silent default.

CREATE TABLE IF NOT EXISTS public.error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'error'
    CHECK (level IN ('debug', 'info', 'warn', 'error', 'critical')),
  message text NOT NULL,
  request_id text NULL DEFAULT NULL,
  route text NULL DEFAULT NULL,
  user_id uuid NULL DEFAULT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Newest-first reads for the owner dashboard.
CREATE INDEX IF NOT EXISTS idx_error_log_created
  ON public.error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_level
  ON public.error_log (level, created_at DESC);

ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

-- Admin read only, via the existing is_admin() pattern (017).
-- No anon/authenticated INSERT, UPDATE or DELETE policy exists:
-- rows are written only through the service-role client.
DROP POLICY IF EXISTS "error_log_select_admin" ON public.error_log;
CREATE POLICY "error_log_select_admin" ON public.error_log
  FOR SELECT TO authenticated
  USING (public.is_admin());
