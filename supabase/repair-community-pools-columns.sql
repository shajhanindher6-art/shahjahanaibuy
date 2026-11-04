-- =====================================================================
-- SmartBuy AI — Repair: missing columns on community/pools tables
-- (run 2026-11-04; kept in the repo so the fix is reproducible)
-- =====================================================================
-- WHY THIS FILE EXISTS: the community_deals, community_deal_votes,
-- pools and pool_members tables existed in production BY NAME but
-- with a PARTIAL schema (e.g. community_deals.user_id and
-- pools.product_id were missing). The original migration files use
-- CREATE TABLE IF NOT EXISTS, which silently skips the CREATE when
-- a table already exists — so re-running them printed "Success"
-- without ever adding the missing columns. The live APIs then
-- failed with Postgres 42703 (undefined_column) while the tables
-- looked present in every name-level check.
--
-- WHAT THIS DOES: adds every column the API routes select, but
-- ONLY where it is missing (ADD COLUMN IF NOT EXISTS). Columns
-- that already exist are left untouched, so this is safe to run
-- on a healthy database too. It then re-applies the RLS policies
-- (idempotent DROP IF EXISTS + CREATE) from the original files.
--
-- OWNER STEP: run this file ONCE in the Supabase SQL Editor
-- (select all with Ctrl+A, then Run). The editor shows only the
-- last result: the information_schema SELECT at the end, which
-- lists every column of the four tables — confirm user_id appears
-- under community_deals and product_id under pools.
-- =====================================================================

ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS author_name text;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS merchant_id uuid REFERENCES merchants(id) ON DELETE SET NULL;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS merchant_name text;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS price numeric(12, 2);
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS deal_text text;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS coupon_code text;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS status text DEFAULT 'approved';
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false;
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE community_deals ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE community_deal_votes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE community_deal_votes ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES community_deals(id) ON DELETE CASCADE;
ALTER TABLE community_deal_votes ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE community_deal_votes ADD COLUMN IF NOT EXISTS value smallint;
ALTER TABLE community_deal_votes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE pools ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE pools ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS region_code text DEFAULT 'US';
ALTER TABLE pools ADD COLUMN IF NOT EXISTS threshold integer DEFAULT 10;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS creator_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE pools ADD COLUMN IF NOT EXISTS status text DEFAULT 'open';
ALTER TABLE pools ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE pool_members ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE pool_members ADD COLUMN IF NOT EXISTS pool_id uuid REFERENCES pools(id) ON DELETE CASCADE;
ALTER TABLE pool_members ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE pool_members ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now();

ALTER TABLE community_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_deal_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "community_deals_select_approved" ON community_deals;
CREATE POLICY "community_deals_select_approved" ON community_deals FOR SELECT TO anon, authenticated USING (status = 'approved');
DROP POLICY IF EXISTS "community_deals_insert_own" ON community_deals;
CREATE POLICY "community_deals_insert_own" ON community_deals FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "community_deals_update_own" ON community_deals;
CREATE POLICY "community_deals_update_own" ON community_deals FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "community_deals_delete_own" ON community_deals;
CREATE POLICY "community_deals_delete_own" ON community_deals FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "community_deal_votes_select_all" ON community_deal_votes;
CREATE POLICY "community_deal_votes_select_all" ON community_deal_votes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "community_deal_votes_insert_own" ON community_deal_votes;
CREATE POLICY "community_deal_votes_insert_own" ON community_deal_votes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "community_deal_votes_update_own" ON community_deal_votes;
CREATE POLICY "community_deal_votes_update_own" ON community_deal_votes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "community_deal_votes_delete_own" ON community_deal_votes;
CREATE POLICY "community_deal_votes_delete_own" ON community_deal_votes FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "pools_select_open" ON pools;
CREATE POLICY "pools_select_open" ON pools FOR SELECT TO anon, authenticated USING (status = 'open');
DROP POLICY IF EXISTS "pools_insert_own" ON pools;
CREATE POLICY "pools_insert_own" ON pools FOR INSERT TO authenticated WITH CHECK (auth.uid() = creator_id);
DROP POLICY IF EXISTS "pools_update_own" ON pools;
CREATE POLICY "pools_update_own" ON pools FOR UPDATE TO authenticated USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);
DROP POLICY IF EXISTS "pool_members_select_all" ON pool_members;
CREATE POLICY "pool_members_select_all" ON pool_members FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "pool_members_insert_own" ON pool_members;
CREATE POLICY "pool_members_insert_own" ON pool_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "pool_members_delete_own" ON pool_members;
CREATE POLICY "pool_members_delete_own" ON pool_members FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Verify (the SQL editor shows only this last result):
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('community_deals', 'community_deal_votes', 'pools', 'pool_members') ORDER BY table_name, ordinal_position;
