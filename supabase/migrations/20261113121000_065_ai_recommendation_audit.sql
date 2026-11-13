-- 065 — AI recommendation / decision audit history (Sections 21–25,
-- Stage E, E-P1-4).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, recommendations are
-- recorded in the in-memory store only
-- (services/ai-recommendation-audit.ts) and the durable writer
-- gracefully no-ops (missing-table → warn, never throw).
--
--   * ai_recommendation_audit stores ONE row per AI recommendation:
--     which surface recommended (assistant-recommend /
--     assistant-compare / assistant-buy-wait / smart-deals /
--     ranked-deals), the user when known (NULL = anonymous/guest —
--     the chat assistant carries no auth context, so it records
--     NULL rather than inventing an identity), the product ids
--     (pick first), the recommendation itself, and the DATA it
--     stood on (verification status, last-checked date, history
--     point count, discount-validation status, merchant-reliability
--     level) in basis jsonb. No free-text user message is stored.
--   * RLS is enabled. Writes are service-role-only: there is NO
--     anon/authenticated INSERT, UPDATE or DELETE policy, so rows
--     are written only through the service-role client (the same
--     pattern as error_log, migration 048). Admins may SELECT
--     through the existing is_admin() function (017); no other
--     role reads the table. Rows are never updated or deleted by
--     the app: the audit trail is append-only by design.
--   * No retention/deletion policy is set here: rows are kept
--     until the owner decides a retention window.

CREATE TABLE IF NOT EXISTS public.ai_recommendation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  surface text NOT NULL
    CHECK (surface IN ('assistant-recommend', 'assistant-compare', 'assistant-buy-wait', 'smart-deals', 'ranked-deals')),
  user_id uuid NULL DEFAULT NULL,
  product_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  recommendation text NOT NULL,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Newest-first reads for the owner dashboard.
CREATE INDEX IF NOT EXISTS idx_ai_recommendation_audit_recorded
  ON public.ai_recommendation_audit (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_recommendation_audit_surface
  ON public.ai_recommendation_audit (surface, recorded_at DESC);

ALTER TABLE public.ai_recommendation_audit ENABLE ROW LEVEL SECURITY;

-- Admin read only, via the existing is_admin() pattern (017).
-- No anon/authenticated INSERT, UPDATE or DELETE policy exists:
-- rows are written only through the service-role client.
DROP POLICY IF EXISTS "ai_recommendation_audit_select_admin" ON public.ai_recommendation_audit;
CREATE POLICY "ai_recommendation_audit_select_admin" ON public.ai_recommendation_audit
  FOR SELECT TO authenticated
  USING (public.is_admin());
