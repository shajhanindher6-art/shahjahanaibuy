-- 051 — Foreign keys from 12 user-owned tables to auth.users (Section 18, item 18; audit §1 #17).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor) AND it needs a live orphan check FIRST:
-- adding a foreign key FAILS if any of the 12 tables already holds
-- a user_id with no matching auth.users row. Before applying, run
-- for each table, e.g.:
--
--   SELECT count(*) FROM public.agent_memory m
--   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id);
--
-- and resolve any orphans the owner reviews (never delete rows
-- silently — see audit §12 REJECTED #17). Only apply once every
-- count is 0.
--
--   * Twelve user-owned tables carry `user_id uuid NOT NULL` with
--     NO REFERENCES: agent_memory, agent_rules, user_expenses,
--     consumer_subscriptions, shopping_lists, monthly_plans,
--     future_you_goals, warranty_claims, smart_home_rules,
--     smart_home_confirmations, eco_budgets, digest_preferences.
--     Consequence today: no CASCADE on account delete, and
--     lib/account-deletion.ts covers none of them, so orphan rows
--     survive account deletion.
--   * Each block adds `REFERENCES auth.users(id) ON DELETE CASCADE`
--     under a stable constraint name (`<table>_user_id_fkey`),
--     guarded so a re-run never fails on a half-applied state: the
--     block runs only when pg_constraint has no constraint of that
--     name on the table.
--   * ON DELETE CASCADE is deliberate: these rows are owned by the
--     user and meaningless without them — the same CASCADE the
--     repo's other user-owned tables already use (e.g. migration
--     008). No data is deleted by this file itself; rows are only
--     removed later, by Postgres, when their owning auth user is
--     deleted.
--   * No RLS change: the tables' existing policies stand.
--   * No orphans are deleted here. Nothing is backfilled.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_memory_user_id_fkey'
      AND conrelid = 'public.agent_memory'::regclass
  ) THEN
    ALTER TABLE public.agent_memory
      ADD CONSTRAINT agent_memory_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_rules_user_id_fkey'
      AND conrelid = 'public.agent_rules'::regclass
  ) THEN
    ALTER TABLE public.agent_rules
      ADD CONSTRAINT agent_rules_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_expenses_user_id_fkey'
      AND conrelid = 'public.user_expenses'::regclass
  ) THEN
    ALTER TABLE public.user_expenses
      ADD CONSTRAINT user_expenses_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consumer_subscriptions_user_id_fkey'
      AND conrelid = 'public.consumer_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.consumer_subscriptions
      ADD CONSTRAINT consumer_subscriptions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shopping_lists_user_id_fkey'
      AND conrelid = 'public.shopping_lists'::regclass
  ) THEN
    ALTER TABLE public.shopping_lists
      ADD CONSTRAINT shopping_lists_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'monthly_plans_user_id_fkey'
      AND conrelid = 'public.monthly_plans'::regclass
  ) THEN
    ALTER TABLE public.monthly_plans
      ADD CONSTRAINT monthly_plans_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'future_you_goals_user_id_fkey'
      AND conrelid = 'public.future_you_goals'::regclass
  ) THEN
    ALTER TABLE public.future_you_goals
      ADD CONSTRAINT future_you_goals_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'warranty_claims_user_id_fkey'
      AND conrelid = 'public.warranty_claims'::regclass
  ) THEN
    ALTER TABLE public.warranty_claims
      ADD CONSTRAINT warranty_claims_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'smart_home_rules_user_id_fkey'
      AND conrelid = 'public.smart_home_rules'::regclass
  ) THEN
    ALTER TABLE public.smart_home_rules
      ADD CONSTRAINT smart_home_rules_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'smart_home_confirmations_user_id_fkey'
      AND conrelid = 'public.smart_home_confirmations'::regclass
  ) THEN
    ALTER TABLE public.smart_home_confirmations
      ADD CONSTRAINT smart_home_confirmations_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eco_budgets_user_id_fkey'
      AND conrelid = 'public.eco_budgets'::regclass
  ) THEN
    ALTER TABLE public.eco_budgets
      ADD CONSTRAINT eco_budgets_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'digest_preferences_user_id_fkey'
      AND conrelid = 'public.digest_preferences'::regclass
  ) THEN
    ALTER TABLE public.digest_preferences
      ADD CONSTRAINT digest_preferences_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
