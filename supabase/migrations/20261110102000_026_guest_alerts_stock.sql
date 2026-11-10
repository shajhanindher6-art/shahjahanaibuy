-- Migration 026: Guest alerts, stock (availability) history, guest push, referrals
--
-- Section 3 items 3 (stock alerts), 7 (guest email alerts), 8 (guest push),
-- 10 (share + referral). All new tables are fail-safe by design: the
-- refresh route and the new API routes catch missing-table errors and
-- degrade to honest empty/queued states, so the site keeps working
-- until the owner runs this migration in Supabase.
--
-- Privacy: no IP address, user agent, or cross-user data is stored in
-- any table below. Guest rows are keyed by an email address (guest
-- email alerts) or a random browser token (guest push / guest
-- referrals) — never by a user account. Email sending itself stays
-- owner-gated via the existing Resend wiring: rows are stored and
-- queued, delivery is only claimed when Resend actually sends.
--
-- No invented data: availability rows record only the merchant
-- listings' own in_stock/availability values; referral click counts
-- count only recorded clicks.

-- ===========================================================================
-- 1. guest_email_alerts — S3#7 guest email alerts (opt-in, unsubscribe)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.guest_email_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('price_drop', 'back_in_stock', 'deal')),
  target_price numeric NULL,
  guest_token text NULL,
  unsubscribe_token text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  active boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz NULL,
  last_triggered_price numeric NULL,
  trigger_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_email_alerts_target_required
    CHECK (alert_type <> 'price_drop' OR target_price IS NOT NULL)
);

-- One live alert of each type per email+product (dedupe).
CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_email_alerts_dedupe
  ON public.guest_email_alerts (email, product_id, alert_type)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_guest_email_alerts_product
  ON public.guest_email_alerts (product_id, active);
CREATE INDEX IF NOT EXISTS idx_guest_email_alerts_unsub
  ON public.guest_email_alerts (unsubscribe_token);

ALTER TABLE public.guest_email_alerts ENABLE ROW LEVEL SECURITY;

-- Opt-in insert only: anyone may create their own alert (email is the
-- non-null owner key), but anonymous clients can never read, update or
-- delete rows. Reads/updates happen only through the service-role
-- client in the cron refresh route and the token-scoped unsubscribe
-- route, which look a row up by its unguessable unsubscribe_token.
DROP POLICY IF EXISTS "guest_email_alerts_insert_anon" ON public.guest_email_alerts;
CREATE POLICY "guest_email_alerts_insert_anon" ON public.guest_email_alerts
  FOR INSERT TO anon
  WITH CHECK (email IS NOT NULL AND product_id IS NOT NULL);

-- ===========================================================================
-- 2. guest_notification_queue — S3#7 queued guest emails (delivery log)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.guest_notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_alert_id uuid NOT NULL REFERENCES public.guest_email_alerts(id) ON DELETE CASCADE,
  email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_notification_queue_pending
  ON public.guest_notification_queue (status, created_at);

ALTER TABLE public.guest_notification_queue ENABLE ROW LEVEL SECURITY;
-- Service-role only: no anon/authenticated policies at all, so the
-- queue (which holds email addresses) is never readable via the API.

-- ===========================================================================
-- 3. availability_history — S3#3 stock snapshots, like price_history
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.availability_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  retailer_id uuid NULL REFERENCES public.retailers(id) ON DELETE SET NULL,
  availability text NOT NULL CHECK (availability IN ('in_stock', 'out_of_stock', 'unknown')),
  in_stock boolean NOT NULL DEFAULT false,
  price numeric NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_availability_history_product
  ON public.availability_history (product_id, recorded_at DESC);

ALTER TABLE public.availability_history ENABLE ROW LEVEL SECURITY;
-- Service-role only (written by the cron refresh route). A public
-- read endpoint is a wave-2 item if the product page ever needs it.

-- ===========================================================================
-- 4. guest_push_subscriptions — S3#8 guest web-push (token-based)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.guest_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_token text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  expiration_time timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_push_subscriptions_token
  ON public.guest_push_subscriptions (guest_token);

ALTER TABLE public.guest_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Insert only, keyed by the browser's own random token. No anon
-- SELECT/UPDATE/DELETE: subscriptions are read only by the
-- service-role client when an alert fires, and removed through the
-- token+endpoint-scoped API route.
DROP POLICY IF EXISTS "guest_push_subscriptions_insert_anon" ON public.guest_push_subscriptions;
CREATE POLICY "guest_push_subscriptions_insert_anon" ON public.guest_push_subscriptions
  FOR INSERT TO anon
  WITH CHECK (guest_token IS NOT NULL AND guest_token <> '' AND endpoint IS NOT NULL AND endpoint <> '');

-- ===========================================================================
-- 5. referral_links + referral_clicks — S3#10 referral links
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.referral_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_token text NULL,
  click_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_links_owner_required
    CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_referral_links_user
  ON public.referral_links (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referral_links_guest
  ON public.referral_links (guest_token)
  WHERE guest_token IS NOT NULL;

ALTER TABLE public.referral_links ENABLE ROW LEVEL SECURITY;

-- Insert only, one link per owner. Signed-in links are created with
-- the caller's user_id; guest links carry the browser's random token.
-- No anon SELECT: click counts are exposed only as an aggregate
-- through the rate-limited API route, never as rows.
DROP POLICY IF EXISTS "referral_links_insert_anon" ON public.referral_links;
CREATE POLICY "referral_links_insert_anon" ON public.referral_links
  FOR INSERT TO anon
  WITH CHECK (code IS NOT NULL AND code <> '' AND (user_id IS NOT NULL OR guest_token IS NOT NULL));

CREATE TABLE IF NOT EXISTS public.referral_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_link_id uuid NOT NULL REFERENCES public.referral_links(id) ON DELETE CASCADE,
  product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_clicks_link
  ON public.referral_clicks (referral_link_id, created_at DESC);

ALTER TABLE public.referral_clicks ENABLE ROW LEVEL SECURITY;

-- Insert only (the click route writes via the service-role client;
-- this policy is a belt-and-braces allowance for anon inserts).
-- No IP address or user agent is ever stored with a click.
DROP POLICY IF EXISTS "referral_clicks_insert_anon" ON public.referral_clicks;
CREATE POLICY "referral_clicks_insert_anon" ON public.referral_clicks
  FOR INSERT TO anon
  WITH CHECK (referral_link_id IS NOT NULL);
