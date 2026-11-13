-- Migration 031: Creator & community rewards (S5#10)
-- Tables for points/badges/leaderboard for verified deal submitters.
--
-- VERIFICATION RULE (read before changing): points are awarded ONLY
-- for deals verified via admin confirmation (is_verified) OR the
-- merchant-price match (see services/community-deals.ts). Upvotes
-- NEVER verify a deal and NEVER earn points. The award API
-- (app/api/v1/creator-rewards/award) re-verifies the deal server-side
-- and inserts one event row per deal — UNIQUE (deal_id) makes a
-- double award impossible.
--
-- - creator_rewards: one row per user, the leaderboard source.
--   display_name is copied from the deal's author_name at award time
--   (the name the submitter already published) — NULL until then.
--   badge is derived from verified_deals in code, stored here only
--   as a read convenience.
-- - creator_reward_events: append-only award ledger, one row per
--   verified deal. No payout amounts live here — revenue share is
--   env-gated wiring only (lib/creator-rewards.ts) until the owner
--   configures CREATOR_REVENUE_SHARE_PERCENT and a payout path.
--
-- RLS: leaderboard rows are public-read (points/badge/display_name
-- only — no email, no payout data). Writes are service-role only:
-- no INSERT/UPDATE/DELETE policy for authenticated users, so the
-- fail-closed default denies them; the admin award route uses the
-- service client. Events are not publicly readable at all.
--
-- SECTION 21–25 GUARD (I-P1-3): applied status is UNKNOWN — only
-- the owner can check schema_migrations, and the repo cannot
-- prove whether this file (or the standalone owner file
-- supabase/add-community-deals.sql that creates
-- `community_deals`) was ever run. `creator_reward_events`
-- REFERENCES community_deals(id), so creating it on a database
-- where the owner file was never run fails outright. The DO block
-- below is the safe choice either way: when `community_deals`
-- does not exist it no-ops with a NOTICE (the rest of the file —
-- `creator_rewards`, which only references `profiles` from 001 —
-- still applies); when the file was already applied, CREATE TABLE
-- IF NOT EXISTS is a no-op the same way. Owner: run
-- supabase/add-community-deals.sql first, then re-run this file
-- to create the events ledger.

CREATE TABLE IF NOT EXISTS creator_rewards (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  display_name text DEFAULT NULL,
  points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  verified_deals integer NOT NULL DEFAULT 0 CHECK (verified_deals >= 0),
  badge text NOT NULL DEFAULT 'none'
    CHECK (badge IN ('none', 'bronze', 'silver', 'gold', 'platinum')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF to_regclass('public.community_deals') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS creator_reward_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      deal_id uuid NOT NULL REFERENCES community_deals(id) ON DELETE CASCADE,
      points integer NOT NULL DEFAULT 10 CHECK (points >= 0),
      reason text NOT NULL DEFAULT 'verified_deal',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (deal_id)
    );
    CREATE INDEX IF NOT EXISTS creator_reward_events_user_idx
      ON creator_reward_events (user_id, created_at DESC);
    ALTER TABLE creator_reward_events ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE '031: creator_reward_events ready.';
  ELSE
    RAISE NOTICE '031: skipped creator_reward_events — public.community_deals does not exist (run supabase/add-community-deals.sql first, then re-run this file).';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS creator_rewards_points_idx
  ON creator_rewards (points DESC, verified_deals DESC);

ALTER TABLE creator_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creator_rewards_select_public" ON creator_rewards;
CREATE POLICY "creator_rewards_select_public" ON creator_rewards FOR SELECT
  TO anon, authenticated USING (true);

-- No INSERT / UPDATE / DELETE policies: only the service-role client
-- (admin award route) writes these tables. Authenticated users
-- attempting a direct write are denied by default (fail-closed).

-- Verify (the SQL editor shows only this last result):
SELECT 'creator_rewards + creator_reward_events ready' AS status;
