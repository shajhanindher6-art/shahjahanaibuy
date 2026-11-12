-- 049 — Stripe webhook event outcome (Section 18, item 46; audit §1 #31).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, the webhook handler
-- keeps its current behaviour exactly: the idempotency early-return
-- skips any already-seen event, and the outcome update is a
-- best-effort write that logs and continues when the columns do
-- not exist (see services/stripe.ts — updateWebhookEventOutcome).
-- Nothing 500s because this file is unapplied.
--
--   * webhook_events (migration 012) recorded only that an event
--     was SEEN: the row was inserted BEFORE the handlers ran, so a
--     failed handler still left a row stamped processed_at, and a
--     Stripe retry hit the idempotency early-return and skipped
--     the handler — a failed event was never reprocessed, and the
--     failure existed only in Vercel logs.
--   * status records the handler outcome: 'pending' (row written,
--     handlers not finished — the value every pre-049 row has by
--     DEFAULT, so old rows keep their old meaning), 'processed'
--     (handlers ran to completion), 'failed' (a handler threw).
--     DEFAULT 'pending' is deliberate: existing rows were written
--     before any outcome was recorded, and 'pending' is the only
--     honest label for them.
--   * error holds the failure text when status is 'failed', and is
--     NULL otherwise. It is the handler's error message only —
--     never a secret, never a full payload.
--   * processed_at (012) is left untouched: it still stamps when
--     the row was first recorded, not when the handlers finished.
--     The outcome lives in status, not in a re-interpretation of
--     processed_at.
--   * The columns are added idempotently (IF NOT EXISTS guards, as
--     in 045) so a re-run never fails on a half-applied state.
--   * No RLS change: the 012 policies stand (SELECT TO
--     authenticated; writes through the service-role client).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_events' AND column_name = 'status') THEN
    ALTER TABLE public.webhook_events ADD COLUMN status text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processed', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'webhook_events' AND column_name = 'error') THEN
    ALTER TABLE public.webhook_events ADD COLUMN error text NULL DEFAULT NULL;
  END IF;
END $$;

-- Failed-event lookups (admin triage + the reprocess-on-retry read).
CREATE INDEX IF NOT EXISTS idx_webhook_events_status
  ON public.webhook_events (status, created_at DESC);
