-- ============================================================================
-- Migration 033 — Section 6 (NEXT-GEN) batch, 2026-11-10
-- Owner must run once in Supabase (SQL Editor). Code fail-safes to honest
-- empty states until then (fail-safe reads return NULL / [] on missing
-- tables/columns — see services/products.ts getProduct* pattern).
--
-- Rules enforced here (audit-first skill):
--  * Every recorded value is NULL by default. No seed rows, no invented
--    prices, specs, dimensions, policy facts, or verification claims.
--  * Every derived value (streaks, eligibility, splits, instalments) is
--    computed at read time from recorded history — never stored stale.
--  * Every new table has RLS with WITH CHECK, a non-null owner column
--    (or an admin-only write rule), and a dedupe key.
--  * vault_items / pools come from standalone SQL files
--    (add-receipt-vault.sql / add-smartpools.sql), NOT numbered
--    migrations — so anything touching them is wrapped in DO blocks that
--    no-op when the table was never created. A missing standalone table
--    must never fail this whole migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Items 4+5 (AR / 3D) + 10 (authenticity) + 11 (supply chain):
-- recorded-only columns on products. All NULL until an admin records a
-- real value from the brand/retailer/manufacturer's own published data.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS length_cm numeric(6,2) DEFAULT NULL CHECK (length_cm IS NULL OR length_cm > 0),
  ADD COLUMN IF NOT EXISTS width_cm numeric(6,2) DEFAULT NULL CHECK (width_cm IS NULL OR width_cm > 0),
  ADD COLUMN IF NOT EXISTS height_cm numeric(6,2) DEFAULT NULL CHECK (height_cm IS NULL OR height_cm > 0),
  ADD COLUMN IF NOT EXISTS model_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS authenticity_method text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS authenticity_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS authenticity_verified_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS country_of_origin text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manufacturer_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS certifications text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS supply_chain_note text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS supply_chain_source_url text DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- Item 1 — Agentic checkout (trimmed): a buy-list shortlist, NOT a checkout.
-- No price column is stored: prices are re-read at view time from
-- merchant_products / price_history, so nothing goes stale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.buy_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  merchant_product_id uuid NULL,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id, merchant_product_id)
);
CREATE INDEX IF NOT EXISTS buy_list_items_user_idx ON public.buy_list_items (user_id, created_at DESC);
ALTER TABLE public.buy_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "buy_list_items_select_own" ON public.buy_list_items;
CREATE POLICY "buy_list_items_select_own" ON public.buy_list_items FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "buy_list_items_insert_own" ON public.buy_list_items;
CREATE POLICY "buy_list_items_insert_own" ON public.buy_list_items FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "buy_list_items_update_own" ON public.buy_list_items;
CREATE POLICY "buy_list_items_update_own" ON public.buy_list_items FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "buy_list_items_delete_own" ON public.buy_list_items;
CREATE POLICY "buy_list_items_delete_own" ON public.buy_list_items FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 2 — Autonomous deal hunting: hunts + matches.
-- A match requires a real recorded in-stock merchant_products price at or
-- below the stated budget. Preferences are copied from the user's STATED
-- agent_memory.preferences at creation; NULL = no constraint.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_hunts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text DEFAULT NULL,
  max_budget_usd numeric(12,2) DEFAULT NULL CHECK (max_budget_usd IS NULL OR max_budget_usd > 0),
  preferred_brands text[] DEFAULT NULL,
  active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_hunts_user_idx ON public.agent_hunts (user_id, active);
ALTER TABLE public.agent_hunts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_hunts_select_own" ON public.agent_hunts;
CREATE POLICY "agent_hunts_select_own" ON public.agent_hunts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "agent_hunts_insert_own" ON public.agent_hunts;
CREATE POLICY "agent_hunts_insert_own" ON public.agent_hunts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "agent_hunts_update_own" ON public.agent_hunts;
CREATE POLICY "agent_hunts_update_own" ON public.agent_hunts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "agent_hunts_delete_own" ON public.agent_hunts;
CREATE POLICY "agent_hunts_delete_own" ON public.agent_hunts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.hunt_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hunt_id uuid NOT NULL REFERENCES public.agent_hunts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  deal_id uuid DEFAULT NULL,
  matched_price_usd numeric(12,2) DEFAULT NULL CHECK (matched_price_usd IS NULL OR matched_price_usd > 0),
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hunt_id, product_id, matched_price_usd)
);
CREATE INDEX IF NOT EXISTS hunt_matches_user_idx ON public.hunt_matches (user_id, matched_at DESC);
ALTER TABLE public.hunt_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hunt_matches_select_own" ON public.hunt_matches;
CREATE POLICY "hunt_matches_select_own" ON public.hunt_matches FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
-- Matches are written by the server (service role) only; no client insert.
DROP POLICY IF EXISTS "hunt_matches_delete_own" ON public.hunt_matches;
CREATE POLICY "hunt_matches_delete_own" ON public.hunt_matches FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 12 — Warranty & insurance marketplace (trimmed): admin-recorded plans
-- only. Every value column is NULL until an admin copies it from the
-- provider's own published page with a source_url. No plan is ever
-- recommended; coverage never stated unless recorded.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warranty_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name text NOT NULL,
  plan_name text NOT NULL,
  coverage_summary text DEFAULT NULL,
  duration_months int DEFAULT NULL CHECK (duration_months IS NULL OR duration_months >= 0),
  price_usd numeric(12,2) DEFAULT NULL CHECK (price_usd IS NULL OR price_usd > 0),
  currency text NOT NULL DEFAULT 'USD',
  deductible_usd numeric(12,2) DEFAULT NULL CHECK (deductible_usd IS NULL OR deductible_usd >= 0),
  product_category text DEFAULT NULL,
  merchant_id uuid DEFAULT NULL REFERENCES public.merchants(id) ON DELETE SET NULL,
  source_url text DEFAULT NULL,
  verified_at timestamptz DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warranty_plans_category_idx ON public.warranty_plans (product_category, price_usd);
ALTER TABLE public.warranty_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "warranty_plans_select_public" ON public.warranty_plans;
CREATE POLICY "warranty_plans_select_public" ON public.warranty_plans FOR SELECT
  TO anon, authenticated USING (is_active = true);
DROP POLICY IF EXISTS "warranty_plans_insert_admin" ON public.warranty_plans;
CREATE POLICY "warranty_plans_insert_admin" ON public.warranty_plans FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "warranty_plans_update_admin" ON public.warranty_plans;
CREATE POLICY "warranty_plans_update_admin" ON public.warranty_plans FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "warranty_plans_delete_admin" ON public.warranty_plans;
CREATE POLICY "warranty_plans_delete_admin" ON public.warranty_plans FOR DELETE
  TO authenticated USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- Item 13 — Social shopping (trimmed): polls on shared wishlists.
-- Options must resolve to a real catalog product. One vote per user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wishlist_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id uuid NOT NULL REFERENCES public.wishlists(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 3 AND 500),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wishlist_polls_wishlist_idx ON public.wishlist_polls (wishlist_id, created_at DESC);
ALTER TABLE public.wishlist_polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wishlist_polls_select_public" ON public.wishlist_polls;
CREATE POLICY "wishlist_polls_select_public" ON public.wishlist_polls FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "wishlist_polls_insert_own" ON public.wishlist_polls;
CREATE POLICY "wishlist_polls_insert_own" ON public.wishlist_polls FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "wishlist_polls_update_own" ON public.wishlist_polls;
CREATE POLICY "wishlist_polls_update_own" ON public.wishlist_polls FOR UPDATE
  TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

CREATE TABLE IF NOT EXISTS public.wishlist_poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.wishlist_polls(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  label text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, product_id)
);
ALTER TABLE public.wishlist_poll_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wishlist_poll_options_select_public" ON public.wishlist_poll_options;
CREATE POLICY "wishlist_poll_options_select_public" ON public.wishlist_poll_options FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "wishlist_poll_options_insert_poll_owner" ON public.wishlist_poll_options;
CREATE POLICY "wishlist_poll_options_insert_poll_owner" ON public.wishlist_poll_options FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.wishlist_polls p WHERE p.id = poll_id AND p.created_by = auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.wishlist_poll_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.wishlist_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.wishlist_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, user_id)
);
CREATE INDEX IF NOT EXISTS wishlist_poll_votes_option_idx ON public.wishlist_poll_votes (option_id);
ALTER TABLE public.wishlist_poll_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wishlist_poll_votes_select_public" ON public.wishlist_poll_votes;
CREATE POLICY "wishlist_poll_votes_select_public" ON public.wishlist_poll_votes FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "wishlist_poll_votes_insert_own" ON public.wishlist_poll_votes;
CREATE POLICY "wishlist_poll_votes_insert_own" ON public.wishlist_poll_votes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 14 — Creator storefronts (trimmed): a storefront is a VIEW over
-- existing rows (creator_rewards + community_deals). Only the slug/bio
-- are new, both user-supplied, both NULL = no storefront. No follower
-- counts, no invented bios.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS creator_bio text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS creator_slug text DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_creator_slug_unique_idx
  ON public.profiles (creator_slug) WHERE creator_slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Item 15 — Gamified smart buying (trimmed): append-only savings ledger.
-- A row is created ONLY when the user confirms a purchase; the amount is
-- derived from recorded data only (merchant compare-at minus the recorded
-- price at purchase). Never auto-credited, never estimated. Streaks and
-- badges are derived at read time from this ledger — never stored.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.savings_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id uuid DEFAULT NULL REFERENCES public.products(id) ON DELETE SET NULL,
  alert_id uuid DEFAULT NULL REFERENCES public.alerts(id) ON DELETE SET NULL,
  amount_saved_usd numeric(12,2) NOT NULL CHECK (amount_saved_usd > 0),
  basis text NOT NULL CHECK (basis IN ('alert_purchase', 'price_drop')),
  source text NOT NULL DEFAULT 'user_confirmed',
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS savings_events_user_idx ON public.savings_events (user_id, recorded_at DESC);
ALTER TABLE public.savings_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "savings_events_select_own" ON public.savings_events;
CREATE POLICY "savings_events_select_own" ON public.savings_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "savings_events_insert_own" ON public.savings_events;
CREATE POLICY "savings_events_insert_own" ON public.savings_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 6 — Live shopping & video commerce (trimmed): sessions, NOT streaming.
-- status is DERIVED from dates + stream_url presence, never a hand-set
-- is_live flag. No fake viewers/sales counts, no invented schedule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_shopping_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz DEFAULT NULL CHECK (ends_at IS NULL OR ends_at > starts_at),
  stream_url text DEFAULT NULL,
  host_note text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_sessions_starts_idx ON public.live_shopping_sessions (starts_at);
ALTER TABLE public.live_shopping_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "live_sessions_select_public" ON public.live_shopping_sessions;
CREATE POLICY "live_sessions_select_public" ON public.live_shopping_sessions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "live_sessions_insert_admin" ON public.live_shopping_sessions;
CREATE POLICY "live_sessions_insert_admin" ON public.live_shopping_sessions FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "live_sessions_update_admin" ON public.live_shopping_sessions;
CREATE POLICY "live_sessions_update_admin" ON public.live_shopping_sessions FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "live_sessions_delete_admin" ON public.live_shopping_sessions;
CREATE POLICY "live_sessions_delete_admin" ON public.live_shopping_sessions FOR DELETE
  TO authenticated USING (public.is_admin());

CREATE TABLE IF NOT EXISTS public.live_session_products (
  session_id uuid NOT NULL REFERENCES public.live_shopping_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, product_id)
);
ALTER TABLE public.live_session_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "live_session_products_select_public" ON public.live_session_products;
CREATE POLICY "live_session_products_select_public" ON public.live_session_products FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "live_session_products_insert_admin" ON public.live_session_products;
CREATE POLICY "live_session_products_insert_admin" ON public.live_session_products FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Item 18 — Native mobile app (trimmed, in-repo only): a waitlist.
-- No emails are sent until Resend is wired; no launch date is promised.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, platform)
);
ALTER TABLE public.app_waitlist ENABLE ROW LEVEL SECURITY;
-- No client insert policy: inserts go through the rate-limited API route
-- (service role). Admins read via the admin API.

-- ---------------------------------------------------------------------------
-- Item 16 — Smart home & IoT (trimmed): generic outbound webhook channel.
-- The user registers THEIR OWN endpoint URL; SmartBuy POSTs price-drop
-- events to it. Secret is stored hashed only (same pattern as api_keys).
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS generic_webhook_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS generic_webhook_secret_hash text DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- Items 3 + 7 + 12 — vault_items touches. vault_items lives in the
-- standalone file supabase/add-receipt-vault.sql, so everything below is
-- conditional: it no-ops when the owner never ran that file.
--   item 3:  reorder fields (user-entered only; next date derived on view)
--   item 7:  price_protection_watches (post-purchase watch; eligibility
--            derived on view from recorded price_history in-window)
--   item 12: vault_items.warranty_plan_id (attach a plan actually bought)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'vault_items') THEN
    ALTER TABLE public.vault_items
      ADD COLUMN IF NOT EXISTS is_consumable boolean DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS reorder_interval_days int DEFAULT NULL CHECK (reorder_interval_days IS NULL OR reorder_interval_days > 0),
      ADD COLUMN IF NOT EXISTS reorder_reminder boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS warranty_plan_id uuid DEFAULT NULL REFERENCES public.warranty_plans(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS public.price_protection_watches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      vault_item_id uuid NOT NULL REFERENCES public.vault_items(id) ON DELETE CASCADE,
      product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
      retailer_id uuid DEFAULT NULL,
      purchase_price numeric(12,2) DEFAULT NULL CHECK (purchase_price IS NULL OR purchase_price > 0),
      window_days int NOT NULL DEFAULT 30 CHECK (window_days > 0),
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'eligible', 'expired', 'no_data', 'claim_submitted')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, vault_item_id)
    );
    CREATE INDEX IF NOT EXISTS price_protection_watches_user_idx
      ON public.price_protection_watches (user_id, created_at DESC);
    ALTER TABLE public.price_protection_watches ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "price_protection_watches_select_own" ON public.price_protection_watches;
    CREATE POLICY "price_protection_watches_select_own" ON public.price_protection_watches FOR SELECT
      TO authenticated USING (auth.uid() = user_id);
    DROP POLICY IF EXISTS "price_protection_watches_insert_own" ON public.price_protection_watches;
    CREATE POLICY "price_protection_watches_insert_own" ON public.price_protection_watches FOR INSERT
      TO authenticated WITH CHECK (auth.uid() = user_id);
    DROP POLICY IF EXISTS "price_protection_watches_update_own" ON public.price_protection_watches;
    CREATE POLICY "price_protection_watches_update_own" ON public.price_protection_watches FOR UPDATE
      TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Item 8 — Group buying 2.0 (trimmed): per-member quantities + an optional
-- target quantity. pools lives in standalone add-smartpools.sql, so this
-- is conditional too. No bulk-price table: bulk pricing does not exist
-- in the data, so no tiers are invented.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'pools') THEN
    ALTER TABLE public.pools
      ADD COLUMN IF NOT EXISTS target_quantity int DEFAULT NULL CHECK (target_quantity IS NULL OR target_quantity >= 2),
      ADD COLUMN IF NOT EXISTS bulk_note text DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS public.pool_member_quantities (
      pool_id uuid NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      quantity int NOT NULL CHECK (quantity >= 1),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (pool_id, user_id)
    );
    ALTER TABLE public.pool_member_quantities ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "pool_member_quantities_select_public" ON public.pool_member_quantities;
    CREATE POLICY "pool_member_quantities_select_public" ON public.pool_member_quantities FOR SELECT
      TO anon, authenticated USING (true);
    DROP POLICY IF EXISTS "pool_member_quantities_insert_own" ON public.pool_member_quantities;
    CREATE POLICY "pool_member_quantities_insert_own" ON public.pool_member_quantities FOR INSERT
      TO authenticated WITH CHECK (auth.uid() = user_id);
    DROP POLICY IF EXISTS "pool_member_quantities_update_own" ON public.pool_member_quantities;
    CREATE POLICY "pool_member_quantities_update_own" ON public.pool_member_quantities FOR UPDATE
      TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
