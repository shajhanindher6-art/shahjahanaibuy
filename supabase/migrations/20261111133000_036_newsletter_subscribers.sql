-- 036 — Newsletter / deal-alert subscribers (Section 12, chunk D).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. The subscribe route (app/api/v1/newsletter/subscribe)
-- and the capture form (components/home/newsletter-capture.tsx)
-- are capture-only and already handle a missing table honestly:
-- until this migration is applied, POST /api/v1/newsletter/subscribe
-- answers 503 "Newsletter signup is not available yet" instead of
-- pretending the signup was stored. Applying the migration is an
-- OWNER step (run once in the Supabase dashboard SQL editor).
--
--   * newsletter_subscribers stores ONLY the email address, where
--     it was captured (footer/homepage), and lifecycle timestamps.
--     No IP address, user agent, or cross-user data is stored.
--   * Email is stored lowercased (the route normalizes before
--     insert) and deduped by a unique index on lower(email), so
--     one address can never have two rows — a repeat signup is
--     answered with the same generic success message as a new one
--     and never leaks whether the address already exists.
--   * confirmed_at / unsubscribed_at are NULL by default (DEFAULT
--     NULL): a fresh row is an unconfirmed, still-subscribed
--     capture. Confirmation and unsubscribe flows are future work;
--     unsubscribe_token (unguessable, like guest_email_alerts in
--     migration 026) is already reserved for them.
--   * No invented or backfilled rows: the table starts EMPTY and a
--     missing row means "never signed up", never an assumed state.
--   * RLS is enabled with an insert-only policy for anon (anyone
--     may create their own signup; the email is the non-null owner
--     key). There is NO anon/authenticated SELECT, UPDATE or DELETE
--     policy, so subscriber emails are never readable via the API —
--     reads happen only through the service-role client.

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  source text NOT NULL DEFAULT 'homepage'
    CHECK (source IN ('footer', 'homepage')),
  unsubscribe_token text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz NULL DEFAULT NULL,
  unsubscribed_at timestamptz NULL DEFAULT NULL,
  CONSTRAINT newsletter_subscribers_email_lowercase
    CHECK (email = lower(email)),
  CONSTRAINT newsletter_subscribers_email_not_empty
    CHECK (email <> '')
);

-- One row per email address (case-insensitive dedupe).
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_email
  ON public.newsletter_subscribers (lower(email));
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_created
  ON public.newsletter_subscribers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_unsub
  ON public.newsletter_subscribers (unsubscribe_token);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Opt-in insert only: anyone may create their own signup, but
-- anonymous clients can never read, update or delete rows.
DROP POLICY IF EXISTS "newsletter_subscribers_insert_anon" ON public.newsletter_subscribers;
CREATE POLICY "newsletter_subscribers_insert_anon" ON public.newsletter_subscribers
  FOR INSERT TO anon
  WITH CHECK (email IS NOT NULL AND email <> '' AND source IN ('footer', 'homepage'));
