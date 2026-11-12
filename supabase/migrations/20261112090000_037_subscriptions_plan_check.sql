-- 037 — Subscriptions plan/status CHECK constraints (Section 15, P2-4).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor), AFTER the route fix in
-- app/api/v1/subscriptions/route.ts is live (that fix already rejects
-- non-'free' plans at the API layer; this constraint is the
-- database-level backstop so no writer — route, admin SQL, or a
-- future client — can ever store a paid plan that was not granted
-- by the Stripe webhook).
--
-- WHY THIS EXISTS — the self-grant bypass (Section 15 audit, Chunk 7):
-- POST /api/v1/subscriptions used to let any authenticated user
-- upsert their own row with ANY plan string + status 'active'
-- whenever Stripe was unconfigured. lib/api-quota.ts
-- getTierForUserId() trusts that row, so a user could grant
-- themselves plan 'team', status 'active' and receive the
-- 100,000/day Team quota, and the billing page rendered them as
-- paid. The route now whitelists plan 'free' only; this CHECK makes
-- the same rule true at the database level.
--
-- PLAN VALUES ALLOWED (from the actual writers, read 2026-11-12):
--   * 'free'    — the only plan the subscriptions route ever writes
--                  (direct upsert), and the plan the webhook writes
--                  on customer.subscription.deleted.
--   * 'pro'     — LEGACY: services/stripe.ts syncSubscriptionFromStripe
--                  defaults to 'pro' when the Stripe subscription has
--                  no plan metadata, and the checkout PlanKey is
--                  'pro' today. Read-compat: lib/api-quota.ts maps
--                  'pro' -> 'premium'. Keep until the P2-2 tier
--                  unification migrates old rows.
--   * 'premium' / 'family' / 'team' — the TierId values in
--                  lib/tiers.ts / lib/api-quota.ts; the webhook will
--                  write these after the P2-2 tier unification
--                  (checkout metadata plan). Allowed now so the
--                  constraint never blocks that planned change.
--   Anything else ('enterprise', 'gold', typos, ...) is rejected.
--
-- STATUS VALUES ALLOWED (from the actual writers):
--   * Stripe subscription statuses, written by the webhook via
--     syncSubscriptionFromStripe: 'active', 'trialing',
--     'past_due', 'canceled', 'incomplete', 'incomplete_expired',
--     'unpaid', 'paused'.
--   * 'canceling' — written by the subscriptions route when the
--     user cancels at period end (cancelAtPeriodEnd). 'canceled'
--     is written by the route for plan 'free' and by the webhook
--     on customer.subscription.deleted.
--   * The table default (migration 009) is status 'active'.
--
-- WHY NOT VALID (not a plain CHECK): migration 009 created
-- subscriptions.plan / .status as unconstrained free text, so live
-- rows may already contain values outside these lists — including
-- rows self-granted before the route fix (e.g. plan 'team' is IN the
-- list, but an arbitrary string such as 'enterprise' or a typo
-- would not be). A plain (validating) CHECK would fail to apply
-- until every violating row is fixed; NOT VALID enforces the rule
-- for every NEW or UPDATED row immediately while leaving existing
-- rows untouched. The owner MUST clean up violating rows before
-- validating (see the commented statements below).
--
-- RLS: intentionally UNCHANGED here. The existing policies
-- (migration 009: select/insert/update own row, TO authenticated)
-- already restrict rows to their owner; the value-level rule
-- belongs in this CHECK, not in a policy, because the Stripe
-- webhook writes paid rows through the anon-key server client
-- (app/api/webhooks/stripe/route.ts) and must never be blocked by
-- a policy that only the route's own writes should satisfy.
-- No new columns, no defaults changed, no data backfilled.

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
    CHECK (plan IN ('free', 'pro', 'premium', 'family', 'team'))
    NOT VALID;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN (
      'active', 'trialing', 'past_due', 'canceled',
      'incomplete', 'incomplete_expired', 'unpaid', 'paused',
      'canceling'
    ))
    NOT VALID;

-- OWNER CLEANUP (run in the SQL editor BEFORE validating, and only
-- after reviewing the rows it returns — never blindly):
--
--   -- 1. See every row that would violate the new constraints:
--   -- SELECT user_id, plan, status FROM public.subscriptions
--   --  WHERE plan NOT IN ('free', 'pro', 'premium', 'family', 'team')
--   --     OR status NOT IN ('active', 'trialing', 'past_due', 'canceled',
--   --                       'incomplete', 'incomplete_expired', 'unpaid',
--   --                       'paused', 'canceling');
--   --
--   -- 2. Downgrade violating rows to free/canceled. A row whose plan
--   --    is outside the list was NEVER granted by Stripe (the webhook
--   --    only writes the listed values), so downgrading it removes a
--   --    self-granted or corrupt entitlement, never a real purchase:
--   -- UPDATE public.subscriptions
--   --    SET plan = 'free', status = 'canceled', updated_at = now()
--   --  WHERE plan NOT IN ('free', 'pro', 'premium', 'family', 'team')
--   --     OR status NOT IN ('active', 'trialing', 'past_due', 'canceled',
--   --                       'incomplete', 'incomplete_expired', 'unpaid',
--   --                       'paused', 'canceling');
--   --
--   -- 3. Only after step 2 returns 0 violating rows, validate:
--   -- ALTER TABLE public.subscriptions
--   --   VALIDATE CONSTRAINT subscriptions_plan_check;
--   -- ALTER TABLE public.subscriptions
--   --   VALIDATE CONSTRAINT subscriptions_status_check;
