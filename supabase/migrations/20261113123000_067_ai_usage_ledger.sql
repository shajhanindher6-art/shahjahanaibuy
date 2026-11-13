-- 067 — Durable AI usage ledger (Sections 21–25, Stage E, E-P2-9).
--
-- DO NOT APPLY YET: this migration is written but intentionally NOT
-- applied. Applying it is an OWNER step (run once in the Supabase
-- dashboard SQL editor). Until it is applied, AI usage lives only
-- in the per-instance in-memory counters
-- (services/ai-engine/usage.ts) and the durable writer
-- (services/ai-engine/usage-ledger.ts) gracefully no-ops
-- (missing-table → warn, never throw).
--
--   * ai_usage_ledger stores ONE row per engine-routed AI
--     capability call: provider key, capability, user when known
--     (NULL = anonymous), success, latency, and cost.
--   * COST MODEL — $0 while deterministic-only. There is no paid
--     LLM in this codebase (no OpenAI / Anthropic / Gemini client;
--     the engine is deterministic templates plus key-gated SerpAPI
--     / HF calls on free tiers), so every row records cost_usd = 0
--     with cost_model = 'deterministic-zero'. If a paid LLM
--     provider is ever added (owner-gated), it must pass its real
--     per-call cost in — the column already accepts it; the $0
--     default must never be read as a measured cost for a paid call.
--   * RLS is enabled. Writes are service-role-only: there is NO
--     anon/authenticated INSERT, UPDATE or DELETE policy, so rows
--     are written only through the service-role client (the same
--     pattern as error_log, migration 048). Admins may SELECT
--     through the existing is_admin() function (017); no other
--     role reads the table. Rows are never updated or deleted by
--     the app: the ledger is append-only by design.
--   * No retention/deletion policy is set here: rows are kept
--     until the owner decides a retention window.

CREATE TABLE IF NOT EXISTS public.ai_usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  provider_key text NOT NULL,
  capability text NOT NULL,
  user_id uuid NULL DEFAULT NULL,
  success boolean NOT NULL DEFAULT true,
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  cost_model text NOT NULL DEFAULT 'deterministic-zero'
);

-- Newest-first reads + per-provider / per-capability rollups.
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_recorded
  ON public.ai_usage_ledger (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_provider
  ON public.ai_usage_ledger (provider_key, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_capability
  ON public.ai_usage_ledger (capability, recorded_at DESC);

ALTER TABLE public.ai_usage_ledger ENABLE ROW LEVEL SECURITY;

-- Admin read only, via the existing is_admin() pattern (017).
-- No anon/authenticated INSERT, UPDATE or DELETE policy exists:
-- rows are written only through the service-role client.
DROP POLICY IF EXISTS "ai_usage_ledger_select_admin" ON public.ai_usage_ledger;
CREATE POLICY "ai_usage_ledger_select_admin" ON public.ai_usage_ledger
  FOR SELECT TO authenticated
  USING (public.is_admin());
