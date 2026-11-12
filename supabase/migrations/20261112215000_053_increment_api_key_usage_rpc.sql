-- 053 — Atomic API quota increment RPC (Section 18, item 20; audit §1 #61).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, lib/api-quota.ts
-- keeps its current read-modify-write path exactly: the code calls
-- this function only when it exists and falls back silently when
-- it does not (missing-function tolerant, never throws). Nothing
-- 500s because this file is unapplied.
--
--   * The quota counter today is read-modify-write
--     (lib/api-quota.ts: read request_count, write count + 1, one
--     23505 retry on first insert only). Two concurrent increments
--     can both read N and both write N + 1 — a lost update, so the
--     quota undercounts and slightly over-allows.
--   * increment_api_key_usage() is ONE statement: INSERT … ON
--     CONFLICT (key_hash, window_date) DO UPDATE SET
--     request_count = api_key_usage.request_count + 1 … RETURNING
--     request_count. The increment happens inside Postgres as a
--     single atomic operation — concurrent callers serialize on
--     the row instead of racing on a stale read. It returns the
--     new count, or NULL only if the row could not be written.
--   * The conflict target is the table's primary key
--     (key_hash, window_date) from migration 035 — no new index
--     is needed. tier is refreshed on every call (the caller's
--     current tier) and updated_at is stamped, matching the
--     existing update path.
--   * SECURITY DEFINER with a fixed search_path (the repo's
--     function convention, migration 001): the function writes a
--     server-only ledger table with no anon/authenticated policy.
--     EXECUTE is revoked from PUBLIC and granted to service_role
--     only — the function is called through the service-role
--     client, never from a browser key. The function body touches
--     no user data: key_hash is a SHA-256 hash, never a raw key.
--   * CREATE OR REPLACE makes a re-run safe. The function takes
--     plain arguments (no defaults) so the call site is explicit.
--   * eBay's counter (services/ebay-budget.ts) is NOT changed
--     here: its DB path already increments with an optimistic
--     compare-and-swap (UPDATE … WHERE calls = <read value>,
--     retry on zero rows), which cannot lost-update — the same
--     read-modify-write shape does not apply there.

CREATE OR REPLACE FUNCTION public.increment_api_key_usage(
  p_key_hash text,
  p_window_date date,
  p_tier text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.api_key_usage (key_hash, window_date, request_count, tier)
  VALUES (p_key_hash, p_window_date, 1, p_tier)
  ON CONFLICT (key_hash, window_date)
  DO UPDATE SET
    request_count = public.api_key_usage.request_count + 1,
    tier = EXCLUDED.tier,
    updated_at = now()
  RETURNING public.api_key_usage.request_count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_api_key_usage(text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_api_key_usage(text, date, text) TO service_role;
