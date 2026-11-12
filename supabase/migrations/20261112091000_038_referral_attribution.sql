-- 038 — Referral signup attribution (Section 15, B13).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the referral code is
-- still carried through sign-up and the attribution endpoint still
-- answers, but attribution is a silent no-op (the service layer
-- treats the missing tables as "attribution not available") and the
-- signup count reads as unavailable — never a fake number.
--
-- DEPENDENCIES (apply in this order):
--   * Migration 001 (20260710063738_001_core_foundation_tables.sql)
--     creates the `profiles` table this migration alters. If 001
--     has not run, the ALTER TABLE below fails.
--   * Migration 026 (20261110102000_026_guest_alerts_stock.sql)
--     creates `referral_links` (code -> user_id) and
--     `referral_clicks`. Attribution resolves a `?ref=` code by
--     looking it up in `referral_links`, so 026 MUST be applied
--     before this one — a ref code whose link row does not exist
--     can never be attributed. (This is the "026 first" noted in
--     the Section 15 audit, Chunk 2, B13.)
--
-- WHAT THIS ADDS:
--   * `profiles.referred_by` — uuid, NULL by default. The id of
--     the referrer's profile (the user who owns the referral link
--     the new user signed up through). NULL means "not referred"
--     and is the value for every existing row: nothing is
--     backfilled, no existing row is changed.
--   * `referral_signups` — one row per attributed signup. The
--     referrer's own signup count (GET /api/v1/referrals?mine=1
--     and the dashboard referral card) is a COUNT over this table,
--     never a stored or guessed number.
--
-- RULES ENFORCED HERE (and mirrored in services/referral-attribution.ts):
--   * No self-referral: referrer <> referred (CHECK on both the
--     column and the table).
--   * One attribution per signup: UNIQUE on referred_user_id.
--   * Guest-owned referral links (user_id NULL in referral_links)
--     can never attribute a signup — the service layer only
--     attributes codes whose link row has a non-null user_id.
--   * Unknown/invalid ref codes are ignored silently by the
--     service layer; they never reach this table.
--
-- RLS: a user can SELECT only rows where they are the referrer or
-- the referred user. There is NO INSERT/UPDATE/DELETE policy for
-- anon or authenticated — rows are written ONLY through the
-- service-role client in the auth callback / attribution endpoint
-- (POST /api/v1/referrals/attribute), which bypasses RLS. Reads of
-- other users' signups are impossible through the API.
--
-- No invented data: the table starts empty and only ever gains
-- rows for signups that actually happened through a valid ref
-- code. Never backfill rows.

-- ===========================================================================
-- 1. profiles.referred_by — NULL default, no existing row changes
-- ===========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by uuid NULL
    REFERENCES public.profiles(id) ON DELETE SET NULL;

-- A profile can never refer itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_referred_by_not_self'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_referred_by_not_self
        CHECK (referred_by IS NULL OR referred_by <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by
  ON public.profiles (referred_by)
  WHERE referred_by IS NOT NULL;

-- ===========================================================================
-- 2. referral_signups — one row per attributed signup
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.referral_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_signups_no_self_referral
    CHECK (referrer_user_id <> referred_user_id)
);

-- One attribution per signup, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_signups_referred_unique
  ON public.referral_signups (referred_user_id);

CREATE INDEX IF NOT EXISTS idx_referral_signups_referrer
  ON public.referral_signups (referrer_user_id, created_at DESC);

ALTER TABLE public.referral_signups ENABLE ROW LEVEL SECURITY;

-- A user reads only their own referral signups: rows where they
-- are the referrer (their count) or the referred user (their own
-- attribution). No other user's rows are ever visible.
DROP POLICY IF EXISTS "referral_signups_select_own" ON public.referral_signups;
CREATE POLICY "referral_signups_select_own" ON public.referral_signups
  FOR SELECT TO authenticated
  USING (auth.uid() = referrer_user_id OR auth.uid() = referred_user_id);

-- No INSERT/UPDATE/DELETE policy for anon or authenticated by
-- design: writes go through the service-role client only
-- (POST /api/v1/referrals/attribute), so a client can never
-- insert a signup for someone else — or for themselves.
