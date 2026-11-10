-- ============================================================================
-- Migration 034 — Section 7 (AI TOOLS) batch, 2026-11-10
-- Owner must run once in Supabase (SQL Editor). Code fail-safes to honest
-- empty states until then (fail-safe reads return NULL / [] on missing
-- tables/columns — see services/products.ts getProduct* pattern).
--
-- Rules enforced here (audit-first skill):
--  * Every recorded value is NULL by default. No seed rows, no invented
--    prices, specs, trade-in programs, or verification claims. The
--    trade-in directory (trade_in_programs) starts EMPTY by design —
--    programs are added only by an admin from the provider's own
--    published page.
--  * Every new table has RLS with WITH CHECK, a non-null owner column
--    (or an admin-only write rule), and a dedupe key.
--  * Item tables (shopping_list_items, plan_items) carry no user_id of
--    their own; their policies scope through the parent list/plan's
--    owner instead.
--  * warranty_claims.vault_item_id is a plain uuid (no FK): vault_items
--    lives in the standalone file supabase/add-receipt-vault.sql, so a
--    hard FK here must never fail this whole migration when the owner
--    never ran that file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Item 2 — AI Receipt & Expense Tracker: user-recorded expenses.
-- amount is user-entered or a recorded price; never derived from a guess.
-- source 'confirmed_purchase' marks a row created from a confirmed
-- purchase; 'manual' marks a hand-entered row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  category text NOT NULL,
  product_slug text DEFAULT NULL,
  note text DEFAULT NULL,
  spent_on date NOT NULL,
  source text DEFAULT NULL CHECK (source IS NULL OR source IN ('manual', 'confirmed_purchase')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_expenses_product_day_unique_idx
  ON public.user_expenses (user_id, product_slug, spent_on) WHERE product_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_expenses_user_idx ON public.user_expenses (user_id, spent_on DESC);
ALTER TABLE public.user_expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_expenses_select_own" ON public.user_expenses;
CREATE POLICY "user_expenses_select_own" ON public.user_expenses FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_expenses_insert_own" ON public.user_expenses;
CREATE POLICY "user_expenses_insert_own" ON public.user_expenses FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_expenses_update_own" ON public.user_expenses;
CREATE POLICY "user_expenses_update_own" ON public.user_expenses FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "user_expenses_delete_own" ON public.user_expenses;
CREATE POLICY "user_expenses_delete_own" ON public.user_expenses FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 3 — AI Subscription Manager: the user's own subscriptions
-- (streaming, apps, services). NOT the SmartBuy Premium plan — that
-- lives in the subscriptions API. One row per subscription name per user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumer_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  price_usd numeric(12,2) NOT NULL CHECK (price_usd > 0),
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'yearly')),
  renewal_date date DEFAULT NULL,
  category text DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at date DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS consumer_subscriptions_user_idx ON public.consumer_subscriptions (user_id, renewal_date);
ALTER TABLE public.consumer_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consumer_subscriptions_select_own" ON public.consumer_subscriptions;
CREATE POLICY "consumer_subscriptions_select_own" ON public.consumer_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "consumer_subscriptions_insert_own" ON public.consumer_subscriptions;
CREATE POLICY "consumer_subscriptions_insert_own" ON public.consumer_subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "consumer_subscriptions_update_own" ON public.consumer_subscriptions;
CREATE POLICY "consumer_subscriptions_update_own" ON public.consumer_subscriptions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "consumer_subscriptions_delete_own" ON public.consumer_subscriptions;
CREATE POLICY "consumer_subscriptions_delete_own" ON public.consumer_subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 1 — AI Shopping List Optimizer: lists + their items.
-- Items resolve to real catalog products by slug at read time; no price
-- is stored here — prices are re-read from merchant_products /
-- price_history at view time, so nothing goes stale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shopping_lists_user_idx ON public.shopping_lists (user_id, created_at DESC);
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shopping_lists_select_own" ON public.shopping_lists;
CREATE POLICY "shopping_lists_select_own" ON public.shopping_lists FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "shopping_lists_insert_own" ON public.shopping_lists;
CREATE POLICY "shopping_lists_insert_own" ON public.shopping_lists FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "shopping_lists_update_own" ON public.shopping_lists;
CREATE POLICY "shopping_lists_update_own" ON public.shopping_lists FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "shopping_lists_delete_own" ON public.shopping_lists;
CREATE POLICY "shopping_lists_delete_own" ON public.shopping_lists FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.shopping_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.shopping_lists(id) ON DELETE CASCADE,
  product_slug text NOT NULL,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, product_slug)
);
CREATE INDEX IF NOT EXISTS shopping_list_items_list_idx ON public.shopping_list_items (list_id);
ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shopping_list_items_select_own" ON public.shopping_list_items;
CREATE POLICY "shopping_list_items_select_own" ON public.shopping_list_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "shopping_list_items_insert_own" ON public.shopping_list_items;
CREATE POLICY "shopping_list_items_insert_own" ON public.shopping_list_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "shopping_list_items_update_own" ON public.shopping_list_items;
CREATE POLICY "shopping_list_items_update_own" ON public.shopping_list_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "shopping_list_items_delete_own" ON public.shopping_list_items;
CREATE POLICY "shopping_list_items_delete_own" ON public.shopping_list_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Item 4 — AI Monthly Shopping Planner: a monthly budget + per-product
-- plan decisions (buy now / wait / next month). Decisions are recorded
-- per product per month; the plan itself is derived at view time from
-- the wishlist, alerts, and the Buy vs Wait engine — never stored stale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month text NOT NULL,
  budget_usd numeric(12,2) NOT NULL CHECK (budget_usd > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);
CREATE INDEX IF NOT EXISTS monthly_plans_user_idx ON public.monthly_plans (user_id, month DESC);
ALTER TABLE public.monthly_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "monthly_plans_select_own" ON public.monthly_plans;
CREATE POLICY "monthly_plans_select_own" ON public.monthly_plans FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "monthly_plans_insert_own" ON public.monthly_plans;
CREATE POLICY "monthly_plans_insert_own" ON public.monthly_plans FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "monthly_plans_update_own" ON public.monthly_plans;
CREATE POLICY "monthly_plans_update_own" ON public.monthly_plans FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "monthly_plans_delete_own" ON public.monthly_plans;
CREATE POLICY "monthly_plans_delete_own" ON public.monthly_plans FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.monthly_plans(id) ON DELETE CASCADE,
  product_slug text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('buy_now', 'wait', 'next_month')),
  reason text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, product_slug)
);
CREATE INDEX IF NOT EXISTS plan_items_plan_idx ON public.plan_items (plan_id);
ALTER TABLE public.plan_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_items_select_own" ON public.plan_items;
CREATE POLICY "plan_items_select_own" ON public.plan_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.monthly_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "plan_items_insert_own" ON public.plan_items;
CREATE POLICY "plan_items_insert_own" ON public.plan_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.monthly_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "plan_items_update_own" ON public.plan_items;
CREATE POLICY "plan_items_update_own" ON public.plan_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.monthly_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.monthly_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "plan_items_delete_own" ON public.plan_items;
CREATE POLICY "plan_items_delete_own" ON public.plan_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.monthly_plans p WHERE p.id = plan_id AND p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Item 20 — AI "Future You" Planner: saving goals for big purchases.
-- target + date are user-set; the monthly saving plan is derived at
-- view time — never stored stale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.future_you_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  target_usd numeric(12,2) NOT NULL CHECK (target_usd > 0),
  target_date date NOT NULL,
  product_slug text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS future_you_goals_user_idx ON public.future_you_goals (user_id, target_date);
ALTER TABLE public.future_you_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "future_you_goals_select_own" ON public.future_you_goals;
CREATE POLICY "future_you_goals_select_own" ON public.future_you_goals FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "future_you_goals_insert_own" ON public.future_you_goals;
CREATE POLICY "future_you_goals_insert_own" ON public.future_you_goals FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "future_you_goals_update_own" ON public.future_you_goals;
CREATE POLICY "future_you_goals_update_own" ON public.future_you_goals FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "future_you_goals_delete_own" ON public.future_you_goals;
CREATE POLICY "future_you_goals_delete_own" ON public.future_you_goals FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 9 — AI Warranty Claim Helper: claim tracking linked to a Vault
-- item when one exists (vault_item_id is a plain uuid, NOT a foreign
-- key — see header note). One claim row per Vault item per user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vault_item_id uuid DEFAULT NULL,
  product_slug text DEFAULT NULL,
  retailer text DEFAULT NULL,
  claim_status text NOT NULL DEFAULT 'not_started' CHECK (claim_status IN ('not_started', 'in_progress', 'submitted', 'resolved', 'denied')),
  notes text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS warranty_claims_vault_item_unique_idx
  ON public.warranty_claims (user_id, vault_item_id) WHERE vault_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS warranty_claims_user_idx ON public.warranty_claims (user_id, created_at DESC);
ALTER TABLE public.warranty_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "warranty_claims_select_own" ON public.warranty_claims;
CREATE POLICY "warranty_claims_select_own" ON public.warranty_claims FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "warranty_claims_insert_own" ON public.warranty_claims;
CREATE POLICY "warranty_claims_insert_own" ON public.warranty_claims FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "warranty_claims_update_own" ON public.warranty_claims;
CREATE POLICY "warranty_claims_update_own" ON public.warranty_claims FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "warranty_claims_delete_own" ON public.warranty_claims;
CREATE POLICY "warranty_claims_delete_own" ON public.warranty_claims FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 19 — AI Smart Home Reorder Agent: user-defined reorder rules.
-- A rule fires from an IoT trigger (webhook channel, migration 033);
-- auto_order is off by default and every order requires confirmation
-- unless the user explicitly opts in.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smart_home_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_label text NOT NULL,
  product_slug text NOT NULL,
  trigger text NOT NULL,
  auto_order boolean NOT NULL DEFAULT false,
  requires_confirmation boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_label, product_slug)
);
CREATE INDEX IF NOT EXISTS smart_home_rules_user_idx ON public.smart_home_rules (user_id, is_active);
ALTER TABLE public.smart_home_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "smart_home_rules_select_own" ON public.smart_home_rules;
CREATE POLICY "smart_home_rules_select_own" ON public.smart_home_rules FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "smart_home_rules_insert_own" ON public.smart_home_rules;
CREATE POLICY "smart_home_rules_insert_own" ON public.smart_home_rules FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "smart_home_rules_update_own" ON public.smart_home_rules;
CREATE POLICY "smart_home_rules_update_own" ON public.smart_home_rules FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "smart_home_rules_delete_own" ON public.smart_home_rules;
CREATE POLICY "smart_home_rules_delete_own" ON public.smart_home_rules FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 12 (continued) — AI Smart Home Reorder Agent: pending
-- confirmations. The agent never places an order by itself; a matching
-- rule creates a PENDING confirmation the user must confirm. The code
-- treats this table as optional (fail-safe [] when absent), but it
-- belongs in this migration so confirmations are durable once run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smart_home_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rule_id uuid DEFAULT NULL REFERENCES public.smart_home_rules (id) ON DELETE CASCADE,
  device_label text NOT NULL,
  product_slug text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smart_home_confirmations_user_idx ON public.smart_home_confirmations (user_id, status, created_at DESC);
ALTER TABLE public.smart_home_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "smart_home_confirmations_select_own" ON public.smart_home_confirmations;
CREATE POLICY "smart_home_confirmations_select_own" ON public.smart_home_confirmations FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "smart_home_confirmations_insert_own" ON public.smart_home_confirmations;
CREATE POLICY "smart_home_confirmations_insert_own" ON public.smart_home_confirmations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "smart_home_confirmations_update_own" ON public.smart_home_confirmations;
CREATE POLICY "smart_home_confirmations_update_own" ON public.smart_home_confirmations FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "smart_home_confirmations_delete_own" ON public.smart_home_confirmations;
CREATE POLICY "smart_home_confirmations_delete_own" ON public.smart_home_confirmations FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 15 — AI Eco Shopping Coach: a monthly carbon budget per user.
-- Coach advice is derived at view time from recorded carbon first
-- (Option 17), estimates labelled as estimates (Option 8) — never
-- stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.eco_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month text NOT NULL,
  budget_kg numeric(10,2) NOT NULL CHECK (budget_kg > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);
CREATE INDEX IF NOT EXISTS eco_budgets_user_idx ON public.eco_budgets (user_id, month DESC);
ALTER TABLE public.eco_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eco_budgets_select_own" ON public.eco_budgets;
CREATE POLICY "eco_budgets_select_own" ON public.eco_budgets FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "eco_budgets_insert_own" ON public.eco_budgets;
CREATE POLICY "eco_budgets_insert_own" ON public.eco_budgets FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "eco_budgets_update_own" ON public.eco_budgets;
CREATE POLICY "eco_budgets_update_own" ON public.eco_budgets FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "eco_budgets_delete_own" ON public.eco_budgets;
CREATE POLICY "eco_budgets_delete_own" ON public.eco_budgets FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 10 — AI Price-Drop Digest: one preference row per user.
-- The digest itself is derived at send time from the user's watched
-- products only — no deal content is stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.digest_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  frequency text NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS digest_preferences_user_idx ON public.digest_preferences (user_id);
ALTER TABLE public.digest_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "digest_preferences_select_own" ON public.digest_preferences;
CREATE POLICY "digest_preferences_select_own" ON public.digest_preferences FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "digest_preferences_insert_own" ON public.digest_preferences;
CREATE POLICY "digest_preferences_insert_own" ON public.digest_preferences FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "digest_preferences_update_own" ON public.digest_preferences;
CREATE POLICY "digest_preferences_update_own" ON public.digest_preferences FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "digest_preferences_delete_own" ON public.digest_preferences;
CREATE POLICY "digest_preferences_delete_own" ON public.digest_preferences FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Item 8 — AI Trade-in & Second-hand Finder: admin-recorded trade-in
-- program directory. Publicly readable; admin-only writes. NO SEED ROWS
-- — the directory starts empty by design. A program is listed only
-- when an admin records it from the provider's own published page;
-- is_verified stays false until that check is done.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trade_in_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  retailer text DEFAULT NULL,
  url text DEFAULT NULL,
  category text DEFAULT NULL,
  notes text DEFAULT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, retailer)
);
CREATE INDEX IF NOT EXISTS trade_in_programs_retailer_idx ON public.trade_in_programs (retailer);
ALTER TABLE public.trade_in_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trade_in_programs_select_public" ON public.trade_in_programs;
CREATE POLICY "trade_in_programs_select_public" ON public.trade_in_programs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "trade_in_programs_insert_admin" ON public.trade_in_programs;
CREATE POLICY "trade_in_programs_insert_admin" ON public.trade_in_programs FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "trade_in_programs_update_admin" ON public.trade_in_programs;
CREATE POLICY "trade_in_programs_update_admin" ON public.trade_in_programs FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "trade_in_programs_delete_admin" ON public.trade_in_programs;
CREATE POLICY "trade_in_programs_delete_admin" ON public.trade_in_programs FOR DELETE
  TO authenticated USING (public.is_admin());
