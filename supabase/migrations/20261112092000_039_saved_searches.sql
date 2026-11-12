-- 039 — Saved Searches (Section 15, C2).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the saved-searches
-- API answers with "not available yet" (503) and the UI shows its
-- honest empty state — never a fake saved search.
--
-- WHAT THIS ADDS:
--   * `saved_searches` — one row per named, re-runnable search a
--     user saved. A save persists the search page's query string
--     (everything /search already URL-syncs: q, sort, store,
--     category, brand, max, minRating, band, page) plus a
--     user-chosen name. Re-running a saved search is just a link
--     back to /search?<query string> — no search is ever
--     re-executed server-side from a saved row.
--
-- RULES ENFORCED HERE (and mirrored in services/saved-searches.ts):
--   * A user reads/writes ONLY their own rows (RLS USING/WITH CHECK
--     auth.uid() = user_id, TO authenticated). There is NO anon
--     policy: guests cannot save searches at all (the UI says so).
--   * Writes go through the AUTHENTICATED cookie-based server
--     client (createSupabaseServerClient), NOT the service-role
--     client: RLS is the own-only enforcement, and the service
--     layer additionally scopes every query with
--     .eq('user_id', userId), so a row can never leak across users
--     even if a policy were dropped. No service-role bypass by
--     design — unlike referral attribution (038), nothing here
--     needs to write on another user's behalf.
--   * Name: 1–100 chars after trimming (CHECK).
--   * Query string: 1–2000 chars after trimming (CHECK).
--   * One name per user (case-insensitive UNIQUE on
--     (user_id, lower(name))): saving the same name twice is an
--     update-by-delete-and-re-save, never a silent duplicate.
--   * No per-user count cap in SQL (a cap of 50 is enforced in the
--     API route, services/saved-searches.ts MAX_SAVED_SEARCHES).
--
-- No invented data: the table starts empty and only ever gains
-- rows a signed-in user explicitly saved. Never backfill rows.

-- ===========================================================================
-- saved_searches
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_searches_name_length
    CHECK (char_length(trim(name)) >= 1 AND char_length(trim(name)) <= 100),
  CONSTRAINT saved_searches_query_length
    CHECK (char_length(trim(query)) >= 1 AND char_length(trim(query)) <= 2000)
);

-- One name per user, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_searches_user_name_unique
  ON public.saved_searches (user_id, lower(name));

-- List newest first, per user.
CREATE INDEX IF NOT EXISTS idx_saved_searches_user_created
  ON public.saved_searches (user_id, created_at DESC);

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

-- A user reads only their own saved searches.
DROP POLICY IF EXISTS "saved_searches_select_own" ON public.saved_searches;
CREATE POLICY "saved_searches_select_own" ON public.saved_searches
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- A user inserts only rows owned by themselves.
DROP POLICY IF EXISTS "saved_searches_insert_own" ON public.saved_searches;
CREATE POLICY "saved_searches_insert_own" ON public.saved_searches
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- A user updates only their own rows, and cannot reassign ownership.
DROP POLICY IF EXISTS "saved_searches_update_own" ON public.saved_searches;
CREATE POLICY "saved_searches_update_own" ON public.saved_searches
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- A user deletes only their own rows.
DROP POLICY IF EXISTS "saved_searches_delete_own" ON public.saved_searches;
CREATE POLICY "saved_searches_delete_own" ON public.saved_searches
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
