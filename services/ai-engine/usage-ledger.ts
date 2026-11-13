/**
 * Durable AI usage ledger (Section 21, Stage E, E-P2-9).
 *
 * Until Section 21 AI usage/cost lived ONLY in per-instance
 * in-memory counters (services/ai-engine/usage.ts): they reset
 * on deploy, are not shared between Vercel instances, and there
 * was no durable row per call to audit. This module is the
 * durable counterpart of `recordAiCapabilityCall` — one row per
 * engine-routed capability call (capability + provider + success
 * + latency), written through the caller's Supabase client.
 *
 * COST MODEL — $0 while deterministic-only. There is no paid LLM
 * in this codebase (no OpenAI / Anthropic / Gemini client; the
 * engine is deterministic templates plus key-gated SerpAPI / HF
 * calls on free tiers). Every ledger row therefore records
 * cost_usd = 0 with cost_model = 'deterministic-zero'. If a paid
 * LLM provider is ever added (owner-gated), the provider must
 * pass its real per-call cost in — the column and the writer
 * already accept it; the $0 default must never be read as a
 * measured cost for a paid call.
 *
 * GRACEFUL NO-OP: the table exists only after migration 067 is
 * applied (owner-gated, NOT applied). Until then the writer
 * logs one warn per missing-table failure and returns false —
 * never throws, never retries, never blocks the AI call it
 * records. The in-memory counters in usage.ts stay the live
 * guardrail; this ledger is the audit trail, not the limiter.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { AIEngineInput, AICapability } from './types';

/**
 * Cost of one deterministic engine call, in USD. Zero by
 * construction: no paid provider is configured, so no call can
 * spend anything. See the header — a paid provider must pass its
 * real cost instead of relying on this default.
 */
export const AI_USAGE_COST_USD_PER_CALL = 0;
/** Cost-model label stored with every $0 row (see the header). */
export const AI_USAGE_COST_MODEL = 'deterministic-zero';

export interface AiUsageLedgerEntry {
  providerKey: string;
  capability: AICapability;
  /** Signed-in user id when the engine input carried one, else null (anonymous). */
  userId: string | null;
  success: boolean;
  latencyMs: number;
  /** USD cost of the call — 0 while deterministic-only (see above). */
  costUsd?: number;
}

/** PostgREST / Postgres codes for "table does not exist". */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

/**
 * Write one ledger row. Never throws: a missing table (migration
 * 067 not applied — the normal state until the owner applies it),
 * a client without `.from`, or any insert failure all degrade to
 * a warn + false. Returns true when the row was written.
 */
export async function recordAiUsageLedger(
  supabase: AnySupabaseClient | null | undefined,
  entry: AiUsageLedgerEntry
): Promise<boolean> {
  try {
    if (!supabase || typeof supabase.from !== 'function') return false;
    const { error } = await supabase.from('ai_usage_ledger').insert({
      provider_key: entry.providerKey,
      capability: entry.capability,
      user_id: entry.userId,
      success: entry.success,
      latency_ms: Math.max(0, Math.round(entry.latencyMs)),
      cost_usd: entry.costUsd ?? AI_USAGE_COST_USD_PER_CALL,
      cost_model: AI_USAGE_COST_MODEL,
    });
    if (error) {
      if (isMissingTableError(error)) {
        logger.warn(
          'recordAiUsageLedger: ai_usage_ledger missing (migration 067 not applied) — in-memory counters only'
        );
      } else {
        logger.warn('recordAiUsageLedger: insert failed', {
          error: error.message,
        });
      }
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('recordAiUsageLedger: unexpected error', {
      error: String(err),
    });
    return false;
  }
}

/**
 * Engine convenience: pull the Supabase client (when the caller
 * passed one in the engine input) and the user id, then write
 * the ledger row fire-and-forget. Callers await nothing — the
 * ledger must never slow down or fail the AI call it records.
 */
export function recordEngineUsageLedger(
  input: AIEngineInput,
  entry: Omit<AiUsageLedgerEntry, 'userId'>
): void {
  const supabase = input.supabase as AnySupabaseClient | null | undefined;
  if (!supabase || typeof supabase.from !== 'function') return;
  const userId =
    typeof input.userId === 'string' && input.userId !== ''
      ? input.userId
      : null;
  void recordAiUsageLedger(supabase, { ...entry, userId });
}
