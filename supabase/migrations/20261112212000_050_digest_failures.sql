-- 050 — Digest failure persistence (Section 18, item 50; audit §1 #35).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, per-user digest
-- failures are only counted (the digest endpoint's `failed` number
-- and one log line) — the persistence call logs and continues
-- when the table does not exist (see
-- services/notifications.ts — recordDigestFailure), and the
-- digest itself never fails because of it.
--
--   * POST /api/v1/notifications/digest counted per-user failures
--     in `failed` but stored the failed user_id / reason nowhere.
--     (Contrast: notification dispatch IS persistent —
--     notification_queue status='failed', last_error,
--     retry_count.) A digest that fails for one user every week
--     was invisible after the response body scrolled away.
--   * digest_failures stores ONE row per failed per-user digest:
--     which user, why (the insert error or the unexpected error
--     that made generateWeeklyDigest return null), and when. One
--     row per failure, not one row per user: a user who fails
--     three weeks running has three rows, so the count is honest.
--   * reason is NOT NULL: a failure with no reason recorded is
--     not a failure record. user_id is NOT NULL: an anonymous
--     digest failure cannot exist — digests are per Premium
--     subscriber. There is deliberately NO retry/status column:
--     a digest is regenerated (or not) on the next weekly run;
--     this table is a record, not a queue.
--   * RLS is enabled. Writes are service-role-only: there is NO
--     anon/authenticated INSERT, UPDATE or DELETE policy, so rows
--     are written only through the service-role client (the same
--     pattern as price_refresh_runs, migration 040, and error_log,
--     migration 048). Admins may SELECT through the existing
--     is_admin() function (017); no other role reads the table.

CREATE TABLE IF NOT EXISTS public.digest_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-user failure history + newest-first reads.
CREATE INDEX IF NOT EXISTS idx_digest_failures_user
  ON public.digest_failures (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_digest_failures_created
  ON public.digest_failures (created_at DESC);

ALTER TABLE public.digest_failures ENABLE ROW LEVEL SECURITY;

-- Admin read only, via the existing is_admin() pattern (017).
-- No anon/authenticated INSERT, UPDATE or DELETE policy exists:
-- rows are written only through the service-role client.
DROP POLICY IF EXISTS "digest_failures_select_admin" ON public.digest_failures;
CREATE POLICY "digest_failures_select_admin" ON public.digest_failures
  FOR SELECT TO authenticated
  USING (public.is_admin());
