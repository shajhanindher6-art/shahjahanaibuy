-- =====================================================================
-- SmartBuy AI — Community-Driven Deal Sharing (Option 6, Feature 3)
-- =====================================================================
-- OWNER STEP: run this file ONCE in the Supabase SQL Editor
-- (select all with Ctrl+A, then Run). The site does NOT depend on
-- these tables at build time: until this migration is run, the
-- community API returns { deals: [], communityEnabled: false } and
-- the deals page shows an honest "community deals activate once
-- this migration is run" note — never a crash, never fake deals.
--
-- Design (honest badges — read before changing):
-- - "Community" = submitted by a signed-in user. Guests can never
--   submit (the API requires auth, same as wishlists).
-- - "Verified" is NEVER earned by upvotes. It is computed in code
--   (services/community-deals.ts): the deal links a catalog product
--   AND a merchant_products row exists for that merchant + product
--   with a price within 5% of the deal price — or an admin sets
--   is_verified directly (service-role/admin only; no admin UI is
--   shipped here, so today verification is purely the price match).
-- - One vote per user per deal: UNIQUE (deal_id, user_id). A vote
--   is +1 or -1; voting again with the same value keeps it, voting
--   the opposite value flips it, and value 0 (via the API) removes it.
-- - New submissions are public immediately with the Community badge
--   (status defaults to 'approved'). A moderation queue (pending /
--   rejected + an admin review UI) is deliberate future work, not
--   silently pretended here.
-- - RLS mirrors the reviews table pattern in this repo: public read
--   of approved rows, users insert/update/delete only their own.
-- =====================================================================

CREATE TABLE IF NOT EXISTS community_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  author_name text,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL,
  merchant_name text,
  price numeric(12, 2),
  deal_text text,
  coupon_code text,
  source_url text,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'rejected')),
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_deal_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES community_deals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_deals_status_idx ON community_deals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS community_deal_votes_deal_idx ON community_deal_votes (deal_id);

ALTER TABLE community_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_deal_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_deals_select_approved" ON community_deals;
CREATE POLICY "community_deals_select_approved" ON community_deals FOR SELECT
  TO anon, authenticated USING (status = 'approved');

DROP POLICY IF EXISTS "community_deals_insert_own" ON community_deals;
CREATE POLICY "community_deals_insert_own" ON community_deals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "community_deals_update_own" ON community_deals;
CREATE POLICY "community_deals_update_own" ON community_deals FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "community_deals_delete_own" ON community_deals;
CREATE POLICY "community_deals_delete_own" ON community_deals FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "community_deal_votes_select_all" ON community_deal_votes;
CREATE POLICY "community_deal_votes_select_all" ON community_deal_votes FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "community_deal_votes_insert_own" ON community_deal_votes;
CREATE POLICY "community_deal_votes_insert_own" ON community_deal_votes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "community_deal_votes_update_own" ON community_deal_votes;
CREATE POLICY "community_deal_votes_update_own" ON community_deal_votes FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "community_deal_votes_delete_own" ON community_deal_votes;
CREATE POLICY "community_deal_votes_delete_own" ON community_deal_votes FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Verify (the SQL editor shows only this last result):
SELECT 'community_deals + community_deal_votes ready' AS status;
