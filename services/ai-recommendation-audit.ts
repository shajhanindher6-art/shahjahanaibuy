/**
 * AI recommendation / decision audit history (Section 21,
 * Stage E, E-P1-4).
 *
 * Until Section 21 the AI wrote NO record of what it
 * recommended, to whom, when, or on what data — a wrong
 * recommendation left no trail to inspect. This module records
 * every AI recommendation in two places:
 *
 * 1. An in-memory store (always available, bounded to the most
 *    recent 500 entries, FIFO). This is the store that works
 *    TODAY, with no migration applied.
 * 2. A durable `ai_recommendation_audit` table (migration 065,
 *    NOT applied — owner-gated). The writer inserts through the
 *    caller's Supabase client and gracefully no-ops when the
 *    table does not exist yet (PGRST205 / 42P01) or the insert
 *    fails for any other reason: an audit failure must never
 *    break the recommendation it records, and must never throw.
 *
 * WHAT IS RECORDED: the surface that recommended, the user id
 * when the caller knows one (null = anonymous/guest — the chat
 * assistant services carry no auth context, so they record null
 * rather than inventing an identity), the product ids, the
 * recommendation itself (pick name / verdict), and the DATA it
 * stood on (verification status, last-checked date, history
 * point count, discount-validation status, merchant-reliability
 * level). No free-text user message is stored — only the
 * recommendation and its basis.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

/** Where the recommendation came from. */
export type AiRecommendationSurface =
  | 'assistant-recommend'
  | 'assistant-compare'
  | 'assistant-buy-wait'
  | 'smart-deals'
  | 'ranked-deals';

/** The data the recommendation stood on — recorded, never assumed. */
export interface AiRecommendationBasis {
  /** Price-verification rollup for the recommended product(s), when known. */
  priceVerificationStatus?: string | null;
  /** Last recorded price check for the recommended product(s), when known. */
  dataFreshness?: string | null;
  /** Recorded price-history points behind a verdict, when known. */
  pointsUsed?: number | null;
  /** Discount-validation status behind a ranked deal, when known. */
  discountValidationStatus?: string | null;
  /** Merchant sync-reliability level behind a ranked deal, when known. */
  merchantReliabilityLevel?: string | null;
}

export interface AiRecommendationAuditEntry {
  /** Unique id (uuid when available, timestamp-counter fallback). */
  id: string;
  /** ISO timestamp the recommendation was made. */
  recordedAt: string;
  surface: AiRecommendationSurface;
  /** Signed-in user id, or null for anonymous/guest. */
  userId: string | null;
  /** Product ids the recommendation covered (pick first). */
  productIds: string[];
  /** The recommendation itself, e.g. "Lowest price pick: MacBook Air 13" or "Verdict: wait". */
  recommendation: string;
  /** The data it stood on. */
  basis: AiRecommendationBasis;
}

/** In-memory bound: the store keeps the most recent 500 entries. */
export const AI_RECOMMENDATION_AUDIT_MAX_ENTRIES = 500;

const memoryStore: AiRecommendationAuditEntry[] = [];
let idCounter = 0;

function newEntryId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // Fall through to the timestamp-counter id.
  }
  idCounter += 1;
  return `ai-rec-${Date.now()}-${idCounter}`;
}

/** PostgREST / Postgres codes for "table does not exist". */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

/**
 * Record a recommendation. Synchronous for the in-memory store
 * (the entry is in the store before this returns), fire-and-
 * forget for the durable table when a client is supplied: the
 * insert is attempted in the background and any failure —
 * missing table (migration 065 unapplied), failed query — is
 * logged once and swallowed, never thrown, never retried.
 * Pass no client to record memory-only (e.g. pure unit paths).
 */
export function recordAiRecommendation(
  supabase: AnySupabaseClient | null | undefined,
  input: {
    surface: AiRecommendationSurface;
    userId?: string | null;
    productIds: string[];
    recommendation: string;
    basis?: AiRecommendationBasis;
  }
): AiRecommendationAuditEntry {
  const entry: AiRecommendationAuditEntry = {
    id: newEntryId(),
    recordedAt: new Date().toISOString(),
    surface: input.surface,
    userId: input.userId ?? null,
    productIds: [...input.productIds],
    recommendation: input.recommendation,
    basis: { ...(input.basis ?? {}) },
  };
  memoryStore.push(entry);
  if (memoryStore.length > AI_RECOMMENDATION_AUDIT_MAX_ENTRIES) {
    memoryStore.splice(0, memoryStore.length - AI_RECOMMENDATION_AUDIT_MAX_ENTRIES);
  }
  if (supabase) {
    void recordAiRecommendationDurable(supabase, entry);
  }
  return entry;
}

/**
 * Durable write for one entry. Never throws: a missing table
 * (migration 065 not applied — the normal state until the owner
 * applies it) degrades to a single warn, any other failure to a
 * single error log. Returns true when the row was written.
 */
export async function recordAiRecommendationDurable(
  supabase: AnySupabaseClient,
  entry: AiRecommendationAuditEntry
): Promise<boolean> {
  try {
    if (typeof supabase?.from !== 'function') return false;
    const { error } = await supabase.from('ai_recommendation_audit').insert({
      id: entry.id,
      recorded_at: entry.recordedAt,
      surface: entry.surface,
      user_id: entry.userId,
      product_ids: entry.productIds,
      recommendation: entry.recommendation,
      basis: entry.basis,
    });
    if (error) {
      if (isMissingTableError(error)) {
        logger.warn(
          'recordAiRecommendationDurable: ai_recommendation_audit missing (migration 065 not applied) — memory-only'
        );
      } else {
        logger.warn('recordAiRecommendationDurable: insert failed', {
          error: error.message,
        });
      }
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('recordAiRecommendationDurable: unexpected error', {
      error: String(err),
    });
    return false;
  }
}

/** Most recent entries first, up to `limit` (default 50, clamped 1–500). */
export function getRecentAiRecommendations(
  limit = 50
): AiRecommendationAuditEntry[] {
  const n = Math.min(
    AI_RECOMMENDATION_AUDIT_MAX_ENTRIES,
    Math.max(1, Math.floor(limit) || 50)
  );
  return [...memoryStore].reverse().slice(0, n);
}

/** Test-only reset for the in-memory store. */
export function resetAiRecommendationAuditStore(): void {
  memoryStore.length = 0;
}
