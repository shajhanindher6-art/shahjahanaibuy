-- SmartPool group-buying pools (Option 8, Feature 2).
-- OWNER: run once in the Supabase SQL editor. The site does NOT depend on
-- these tables at build time: until this runs, the pool UI shows an
-- explanatory note (never a crash, never fake pools).
--
-- HONESTY: reaching a pool's threshold expresses collective buying interest
-- only. It does NOT guarantee a discount or a retailer offer — SmartBuy has
-- no retailer partnership for group pricing. No fake members: the creator
-- is member #1 and the count only grows by real joins.

CREATE TABLE IF NOT EXISTS pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  region_code text NOT NULL DEFAULT 'US',
  threshold integer NOT NULL DEFAULT 10 CHECK (threshold >= 2),
  creator_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pool_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pool_id, user_id)
);

CREATE INDEX IF NOT EXISTS pools_product_idx ON pools (product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS pool_members_pool_idx ON pool_members (pool_id);

ALTER TABLE pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pools_select_open" ON pools;
CREATE POLICY "pools_select_open" ON pools FOR SELECT
  TO anon, authenticated USING (status = 'open');

DROP POLICY IF EXISTS "pools_insert_own" ON pools;
CREATE POLICY "pools_insert_own" ON pools FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "pools_update_own" ON pools;
CREATE POLICY "pools_update_own" ON pools FOR UPDATE
  TO authenticated USING (auth.uid() = creator_id) WITH CHECK (auth.uid() = creator_id);

DROP POLICY IF EXISTS "pool_members_select_all" ON pool_members;
CREATE POLICY "pool_members_select_all" ON pool_members FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "pool_members_insert_own" ON pool_members;
CREATE POLICY "pool_members_insert_own" ON pool_members FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "pool_members_delete_own" ON pool_members;
CREATE POLICY "pool_members_delete_own" ON pool_members FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
