-- 043 — Saved calculations (Section 16, #36).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the save button on
-- the pure-local calculator tools answers with "not available yet"
-- (503) and the shareable link still works — a calculation is never
-- claimed saved to an account that cannot hold it.
--
-- WHAT THIS ADDS:
--   * `saved_calculations` — one row per calculation a signed-in
--     user explicitly saved from a pure client-side tool (EMI,
--     landed-cost, gift-splitter, currency-converter, budget-finder,
--     forecast-explainer, and the other localStorage-only tools).
--     A row stores the tool slug, a user-chosen label, and the
--     tool's input params as JSON (the same query params the tool's
--     shareable URL carries — re-opening a saved calculation is just
--     a link back to /tools/<tool>?<params>).
--   * `share_token` — a random token per row, so a saved
--     calculation can be shared as /tools/<tool>?saved=<token>
--     without exposing the row id.
--
-- RULES ENFORCED HERE (and mirrored in
-- services/saved-calculations.ts):
--   * A user reads/writes ONLY their own rows (RLS USING/WITH
--     CHECK auth.uid() = user_id, TO authenticated). There is NO
--     anon policy: guests cannot save calculations to an account
--     (the UI says so — guests get the shareable link instead).
--   * Writes go through the AUTHENTICATED cookie-based server
--     client, NOT the service-role client.
--   * Tool: one of the 12 pure-local tool slugs (CHECK).
--   * Label: 1–100 chars after trimming (CHECK).
--   * Params: a JSON object of at most 50 string/number/boolean
--     values (CHECK on jsonb size via char_length — the service
--     enforces the shape; the DB enforces the size cap).
--   * One share_token per row (UNIQUE); the token is generated
--     server-side (crypto.randomUUID), never client-supplied.
--   * No per-user count cap in SQL (a cap of 50 is enforced in the
--     API route).
--
-- No invented data: the table starts empty and only ever gains
-- rows a signed-in user explicitly saved. Never backfill rows.

CREATE TABLE IF NOT EXISTS public.saved_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool text NOT NULL,
  label text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  share_token text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_calculations_tool_check
    CHECK (tool IN (
      'emi-calculator', 'landed-cost', 'gift-splitter',
      'currency-converter', 'budget-finder', 'forecast-explainer',
      'future-you-planner', 'monthly-planner', 'expense-tracker',
      'subscription-manager', 'savings-dashboard', 'list-optimizer'
    )),
  CONSTRAINT saved_calculations_label_length
    CHECK (char_length(trim(label)) >= 1 AND char_length(trim(label)) <= 100),
  CONSTRAINT saved_calculations_params_size
    CHECK (char_length(params::text) <= 4096)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_calculations_share_token
  ON public.saved_calculations (share_token);

-- List newest first, per user.
CREATE INDEX IF NOT EXISTS idx_saved_calculations_user_created
  ON public.saved_calculations (user_id, created_at DESC);

ALTER TABLE public.saved_calculations ENABLE ROW LEVEL SECURITY;

-- A user reads only their own saved calculations.
DROP POLICY IF EXISTS "saved_calculations_select_own" ON public.saved_calculations;
CREATE POLICY "saved_calculations_select_own" ON public.saved_calculations
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- A user inserts only rows owned by themselves.
DROP POLICY IF EXISTS "saved_calculations_insert_own" ON public.saved_calculations;
CREATE POLICY "saved_calculations_insert_own" ON public.saved_calculations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- A user deletes only their own rows.
DROP POLICY IF EXISTS "saved_calculations_delete_own" ON public.saved_calculations;
CREATE POLICY "saved_calculations_delete_own" ON public.saved_calculations
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- A user updates only their own rows (and cannot hand a row to
-- another user: WITH CHECK re-pins the owner on the new row).
-- Section 17, Stage H, item 13 (audit §4 #9): SELECT/INSERT/DELETE
-- own policies existed but FOR UPDATE count was 0, so calculations
-- could only be deleted and recreated, never edited.
DROP POLICY IF EXISTS "saved_calculations_update_own" ON public.saved_calculations;
CREATE POLICY "saved_calculations_update_own" ON public.saved_calculations
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
