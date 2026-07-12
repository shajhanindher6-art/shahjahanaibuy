-- =============================================================
-- Phase 5: Production Launch — Database Extensions
-- =============================================================
-- Adds: webhook event idempotency, push subscriptions, email log,
-- billing history (invoices), notification retry tracking.
-- =============================================================

-- --- webhook_events: Stripe webhook idempotency ---
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text UNIQUE NOT NULL,
  event_type text NOT NULL,
  payload jsonb,
  processed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_webhook_events ON webhook_events FOR SELECT TO authenticated
  USING (id IS NOT NULL);

-- --- push_subscriptions: browser push notification endpoints ---
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  expiration_time timestamptz,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_own_push_subscriptions ON push_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY insert_own_push_subscriptions ON push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY delete_own_push_subscriptions ON push_subscriptions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

-- --- email_log: track email delivery status ---
CREATE TABLE IF NOT EXISTS public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  email_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_own_email_log ON email_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE INDEX idx_email_log_user ON email_log(user_id);
CREATE INDEX idx_email_log_status ON email_log(status);

-- --- billing_history: invoice records from Stripe ---
CREATE TABLE IF NOT EXISTS public.billing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_invoice_id text UNIQUE,
  stripe_charge_id text,
  amount_paid integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'open',
  invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.billing_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_own_billing_history ON billing_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY insert_own_billing_history ON billing_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_billing_history_user ON billing_history(user_id);

-- --- Add columns to subscriptions for full Stripe sync ---
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_start timestamptz,
  ADD COLUMN IF NOT EXISTS trial_end timestamptz;

-- --- Add retry columns to notification_queue ---
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
