-- ============================================================
-- 027 — Personal AI shopping agent (S5#1): user memory +
-- autonomous rules
-- ============================================================
-- WHAT THIS DOES: two new user-owned tables.
--
--   agent_memory — ONE row per user (user_id UNIQUE):
--     * preferences jsonb — the user's STATED preferences only
--       (maxBudgetUsd, categories, preferredBrands,
--       lightweightOnly). Never inferred, never invented.
--       NULL defaults: a fresh row carries an empty object.
--     * seen_product_slugs jsonb — product slugs the user viewed,
--       most recent first, capped at 50 by the app. Empty array
--       by default.
--     * consent_granted_at timestamptz — when the user explicitly
--       turned memory on. NULL = memory not granted. Turning
--       memory off deletes the row (the API DELETEs it).
--
--   agent_rules — autonomous rules ("alert me under $800"):
--     * user_id uuid NOT NULL — the owner. No anonymous rows.
--     * product_slug text NOT NULL + product_id uuid NULL — the
--       watched product. The slug is the dedupe key (products are
--       resolved to ids by the API when possible).
--     * target_price_usd numeric(12,2) NOT NULL CHECK > 0 — the
--       user-stated target. No default, no invented target.
--     * channel text CHECK (email|push|both) — notification
--       channel for the linked alert. Guests never get rows here;
--       their rules live in localStorage only.
--     * alert_id uuid NULL — the linked row in the EXISTING
--       `alerts` table (migration 006). Rules fire through the
--       existing 6-hour cron alert chain, never a second chain.
--       NULL = the alert could not be created (see the API: the
--       rule is kept and honestly reported as unlinked).
--     * active / last_triggered_at / trigger_count — rule state.
--
-- DEDUPE: UNIQUE(user_id, product_slug, target_price_usd) — one
-- active target per user + product + price.
--
-- RLS: owner-only on both tables. Every policy requires
-- auth.uid() = user_id, WITH CHECK on INSERT/UPDATE. No anon
-- access at all (guests use localStorage, never these tables).
--
-- OWNER STEP: run this file ONCE in the Supabase SQL Editor.
-- SAFE TO RUN on a healthy database too: CREATE TABLE IF NOT
-- EXISTS + DROP POLICY IF EXISTS leave existing data untouched.
-- The site does NOT depend on these tables: until this runs, the
-- /api/v1/agent/* routes return honest empty states / a
-- setupRequired flag (never a crash, never fake data).
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  seen_product_slugs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(seen_product_slugs) = 'array'),
  consent_granted_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  product_id uuid DEFAULT NULL,
  product_slug text NOT NULL,
  product_name text DEFAULT NULL,
  target_price_usd numeric(12,2) NOT NULL CHECK (target_price_usd > 0),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'push', 'both')),
  alert_id uuid DEFAULT NULL,
  active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz DEFAULT NULL,
  trigger_count int NOT NULL DEFAULT 0 CHECK (trigger_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_rules_product_present CHECK (product_id IS NOT NULL OR product_slug IS NOT NULL),
  CONSTRAINT agent_rules_one_target_per_user_product_price UNIQUE (user_id, product_slug, target_price_usd)
);

CREATE INDEX IF NOT EXISTS idx_agent_rules_user_id ON agent_rules (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_rules_product_slug ON agent_rules (product_slug);
CREATE INDEX IF NOT EXISTS idx_agent_rules_active ON agent_rules (user_id, active);

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_rules ENABLE ROW LEVEL SECURITY;

-- agent_memory: owner-only (select / insert / update / delete).
DROP POLICY IF EXISTS "agent_memory_select_own" ON agent_memory;
CREATE POLICY "agent_memory_select_own"
  ON agent_memory FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_memory_insert_own" ON agent_memory;
CREATE POLICY "agent_memory_insert_own"
  ON agent_memory FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_memory_update_own" ON agent_memory;
CREATE POLICY "agent_memory_update_own"
  ON agent_memory FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_memory_delete_own" ON agent_memory;
CREATE POLICY "agent_memory_delete_own"
  ON agent_memory FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- agent_rules: owner-only (select / insert / update / delete).
DROP POLICY IF EXISTS "agent_rules_select_own" ON agent_rules;
CREATE POLICY "agent_rules_select_own"
  ON agent_rules FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_rules_insert_own" ON agent_rules;
CREATE POLICY "agent_rules_insert_own"
  ON agent_rules FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_rules_update_own" ON agent_rules;
CREATE POLICY "agent_rules_update_own"
  ON agent_rules FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agent_rules_delete_own" ON agent_rules;
CREATE POLICY "agent_rules_delete_own"
  ON agent_rules FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Verify (the SQL editor shows only this last result):
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('agent_memory', 'agent_rules')
ORDER BY table_name;
