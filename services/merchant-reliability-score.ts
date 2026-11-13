/**
 * Merchant reliability from refresh / sync history (Section 20, #10).
 *
 * The merchants table today carries only status / active /
 * commission_rate — no trust columns — and the recorded-trust
 * scorer in services/merchant-reliability.ts scores policy and
 * directory signals, not sync behaviour. This module adds the
 * missing dimension: does this merchant's catalog data actually
 * get refreshed, and do the refresh runs that carry it succeed?
 *
 * Signals (all recorded, none assumed):
 *   1. Refresh-run history — recent rows of `price_refresh_runs`
 *      (migration 040). A run is "healthy" when its status is
 *      'completed'; 'completed_with_failures' counts as half
 *      healthy; 'failed' / still-'running' count as unhealthy.
 *      This is a SYSTEM signal (runs cover the whole catalog,
 *      not one merchant), so it is labelled as such and capped
 *      at 30 of the 100 points — it can never score a merchant
 *      on its own.
 *   2. Fresh listings — the share of this merchant's
 *      `merchant_products` rows whose `last_synced_at` is within
 *      STALE_PRICE_DAYS (7). 50 points, pro-rata: a merchant
 *      whose listings were all synced this week scores full
 *      marks here; one whose listings were last touched at seed
 *      time (2026-11-02) scores 0.
 *   3. Listing depth — 20 points for 5+ live listings, 10 for
 *      1–4. A merchant that actually lists products is more
 *      established than one that lists none.
 *
 * FAIL-SAFE "insufficient data" — the score is null (never a
 * guessed number) when:
 *   * `price_refresh_runs` is unreadable or has no rows — the
 *     table does not exist until migration 040 is applied, so
 *     today this is the expected result for every merchant;
 *   * the merchant has no live listings at all.
 * The returned explanation always names exactly what is missing,
 * so the owner knows the unblock (apply 040 + run a refresh).
 *
 * Pure scorer + fail-safe DB reader. The DB reader never throws:
 * a missing table (PGRST205 / 42P01), a failed query, or an
 * empty history all degrade to the insufficient-data state.
 *
 * Sections 21–25, Stage B (A10) — CANONICAL-SCORER NOTE, READ
 * BEFORE DELETING THIS FILE: the Stage A audit called this scorer
 * dead code (zero callers), but that premise was stale by build
 * time — Stage E wired it into services/ai-deals.ts
 * (fetchMerchantSyncReliability → scoreDeal), where it is the
 * freshness dimension for deal ranking. Deleting it would break
 * that surface. So BOTH scorers now have production callers and
 * NEITHER is deleted:
 *   - services/merchant-reliability.ts (policy/trust/directory
 *     signals) is the CANONICAL scorer for the admin merchant
 *     surfaces — wired into the /admin/ai provider-health panel
 *     (services/provider-status.ts) and consumed by
 *     services/ai-comparison.ts;
 *   - this file (sync/freshness signals) stays the deal-ranking
 *     freshness dimension in services/ai-deals.ts.
 * Do NOT add a third scorer. If the two ever need merging, that
 * is a Stage E decision, not a deletion.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { STALE_PRICE_DAYS } from '@/lib/price-freshness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MerchantSyncReliabilityLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface MerchantSyncReliabilitySignal {
  key: string;
  label: string;
  /** True when this signal contributed to the score. */
  present: boolean;
  /** Plain-language detail (shown in the explanation). */
  detail: string;
}

export interface MerchantSyncReliability {
  merchantId: string;
  merchantName: string;
  /** 0–100 when enough signals exist; null = insufficient data. */
  score: number | null;
  level: MerchantSyncReliabilityLevel;
  /** 'scored' | 'insufficient-data' — the UI renders the honest empty state on the latter. */
  status: 'scored' | 'insufficient-data';
  /** Plain-language explanation: the score + which signals fed it, or what is missing. */
  explanation: string;
  /** True when the score is null. */
  notEnoughData: boolean;
  /** How many recent refresh runs were considered (0 when the table is missing/empty). */
  runsConsidered: number;
  /** Share of recent runs that completed (null when no runs). */
  runSuccessRate: number | null;
  /** Live listings for this merchant. */
  totalListings: number;
  /** Listings synced within STALE_PRICE_DAYS. */
  freshListings: number;
  /** Most recent last_synced_at across the merchant's listings (null when none). */
  lastSyncedAt: string | null;
  signals: MerchantSyncReliabilitySignal[];
}

/** Everything the pure scorer needs — all recorded, none assumed. */
export interface MerchantSyncReliabilityInput {
  merchantId: string;
  merchantName: string;
  /** Recent price_refresh_runs rows (newest first, capped by the reader). May be []. */
  runs: Array<{ status: string; startedAt: string }>;
  /** Live merchant_products rows for this merchant. */
  totalListings: number;
  /** Of those, rows with last_synced_at within STALE_PRICE_DAYS. */
  freshListings: number;
  /** Most recent last_synced_at across the merchant's listings (null when none). */
  lastSyncedAt: string | null;
}

/** Points budget: fresh listings 50, listing depth 20, run health 30. */
const FRESH_LISTINGS_MAX_POINTS = 50;
const LISTING_DEPTH_FIVE_PLUS_POINTS = 20;
const LISTING_DEPTH_ONE_PLUS_POINTS = 10;
const RUN_HEALTH_MAX_POINTS = 30;
/** How many recent runs the reader considers. */
export const SYNC_RELIABILITY_RUNS_WINDOW = 20;

// ---------------------------------------------------------------------------
// Pure scoring
// ---------------------------------------------------------------------------

/**
 * Score a merchant from recorded sync history only. Returns a null
 * score (insufficient-data) when there is no refresh-run history
 * at all (migration 040 unapplied / no runs recorded) or when the
 * merchant has no live listings — in both cases a number would be
 * a guess. The explanation always names what is missing.
 */
export function scoreMerchantSyncReliability(
  input: MerchantSyncReliabilityInput
): MerchantSyncReliability {
  const signals: MerchantSyncReliabilitySignal[] = [];

  // Run health: completed = 1, completed_with_failures = 0.5,
  // anything else (failed / still running) = 0.
  let runHealth = 0;
  let runSuccessRate: number | null = null;
  if (input.runs.length > 0) {
    let healthy = 0;
    for (const run of input.runs) {
      if (run.status === 'completed') healthy += 1;
      else if (run.status === 'completed_with_failures') healthy += 0.5;
    }
    runHealth = healthy / input.runs.length;
    runSuccessRate = runHealth;
  }
  const runHealthPoints =
    input.runs.length > 0 ? Math.round(runHealth * RUN_HEALTH_MAX_POINTS) : 0;
  signals.push({
    key: 'refresh_runs',
    label: 'Refresh-run health (system-wide)',
    present: input.runs.length > 0,
    detail:
      input.runs.length === 0
        ? 'no refresh runs recorded — price_refresh_runs is empty or the table does not exist yet (migration 040 not applied)'
        : `${input.runs.length} recent refresh run${input.runs.length === 1 ? '' : 's'} considered, ` +
          `${Math.round(runHealth * 100)}% healthy (completed runs count fully, completed-with-failures half)`,
  });

  const freshShare =
    input.totalListings > 0 ? input.freshListings / input.totalListings : 0;
  const freshPoints = Math.round(freshShare * FRESH_LISTINGS_MAX_POINTS);
  signals.push({
    key: 'fresh_listings',
    label: `Listings synced in the last ${STALE_PRICE_DAYS} days`,
    present: input.freshListings > 0,
    detail:
      input.totalListings === 0
        ? 'no live listings for this merchant'
        : input.freshListings === 0
          ? `0 of ${input.totalListings} listing${input.totalListings === 1 ? '' : 's'} synced in the last ${STALE_PRICE_DAYS} days` +
            (input.lastSyncedAt ? ` (most recent sync ${input.lastSyncedAt})` : ' (never synced)')
          : `${input.freshListings} of ${input.totalListings} listing${input.totalListings === 1 ? '' : 's'} synced in the last ${STALE_PRICE_DAYS} days`,
  });

  const depthPoints =
    input.totalListings >= 5
      ? LISTING_DEPTH_FIVE_PLUS_POINTS
      : input.totalListings >= 1
        ? LISTING_DEPTH_ONE_PLUS_POINTS
        : 0;
  signals.push({
    key: 'listing_depth',
    label: 'Live listings',
    present: input.totalListings >= 1,
    detail:
      input.totalListings === 0
        ? 'no live listings for this merchant'
        : `${input.totalListings} live listing${input.totalListings === 1 ? '' : 's'}`,
  });

  const base: Omit<
    MerchantSyncReliability,
    'score' | 'level' | 'status' | 'explanation' | 'notEnoughData'
  > = {
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    runsConsidered: input.runs.length,
    runSuccessRate,
    totalListings: input.totalListings,
    freshListings: input.freshListings,
    lastSyncedAt: input.lastSyncedAt,
    signals,
  };

  // Fail-safe: no run history, or no listings — no score, ever.
  if (input.runs.length === 0) {
    return {
      ...base,
      score: null,
      level: 'unknown',
      status: 'insufficient-data',
      explanation:
        `Not enough data to score ${input.merchantName} from sync history — ` +
        `no refresh runs have been recorded (price_refresh_runs is empty or the table ` +
        `does not exist yet; migration 040 is not applied). ` +
        `Apply migration 040 and let a refresh run complete, then this score appears.`,
      notEnoughData: true,
    };
  }
  if (input.totalListings === 0) {
    return {
      ...base,
      score: null,
      level: 'unknown',
      status: 'insufficient-data',
      explanation:
        `Not enough data to score ${input.merchantName} from sync history — ` +
        `the merchant has no live listings, so there is nothing whose freshness can be measured.`,
      notEnoughData: true,
    };
  }

  const score = freshPoints + depthPoints + runHealthPoints;
  const level: MerchantSyncReliabilityLevel =
    score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  // The explanation states EVERY signal's detail, not just the
  // contributing ones — a leg that scored 0 (e.g. 0 of 10 listings
  // synced in the last 7 days) must be said out loud, otherwise a
  // stale merchant's score looks unexplained. Each detail is
  // already plain language (see the signals above).
  return {
    ...base,
    score,
    level,
    status: 'scored',
    explanation:
      `Sync reliability ${score}/100 (${level}) for ${input.merchantName} — ` +
      `${signals.map((s) => s.detail).join('; ')}. ` +
      `Refresh-run health is a system-wide signal (runs cover the whole catalog, not this merchant alone).`,
    notEnoughData: false,
  };
}

// ---------------------------------------------------------------------------
// Fail-safe DB reader
// ---------------------------------------------------------------------------

/** PostgREST / Postgres codes for "table does not exist". */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01';
}

/**
 * Score one merchant from the live database. Never throws: a
 * missing price_refresh_runs table (migration 040 unapplied), an
 * empty run history, a missing merchant, or a failed query all
 * degrade to the insufficient-data state (score null).
 */
export async function getMerchantSyncReliability(
  supabase: AnySupabaseClient,
  merchantId: string,
  merchantName: string
): Promise<MerchantSyncReliability> {
  const insufficient = (
    runs: Array<{ status: string; startedAt: string }>,
    totalListings: number,
    freshListings: number,
    lastSyncedAt: string | null
  ): MerchantSyncReliability =>
    scoreMerchantSyncReliability({
      merchantId,
      merchantName,
      runs,
      totalListings,
      freshListings,
      lastSyncedAt,
    });

  try {
    // Recent refresh runs (newest first). A missing table is the
    // normal pre-040 state — not an error, just "no history".
    let runs: Array<{ status: string; startedAt: string }> = [];
    try {
      const { data, error } = await supabase
        .from('price_refresh_runs')
        .select('status, started_at')
        .order('started_at', { ascending: false })
        .limit(SYNC_RELIABILITY_RUNS_WINDOW);
      if (error) {
        if (isMissingTableError(error)) {
          logger.warn('getMerchantSyncReliability: price_refresh_runs missing (migration 040 not applied) — insufficient data');
        } else {
          logger.warn('getMerchantSyncReliability: refresh-runs query failed', { error: error.message });
        }
        runs = [];
      } else {
        runs = (data ?? []).map((row) => ({
          status: String((row as Record<string, unknown>).status ?? ''),
          startedAt: String((row as Record<string, unknown>).started_at ?? ''),
        }));
      }
    } catch {
      runs = [];
    }

    // This merchant's live listings + their last sync times.
    let totalListings = 0;
    let freshListings = 0;
    let lastSyncedAt: string | null = null;
    try {
      const { data, error } = await supabase
        .from('merchant_products')
        .select('last_synced_at')
        .eq('merchant_id', merchantId)
        .is('deleted_at', null)
        .limit(500);
      if (!error && data) {
        const cutoff = Date.now() - STALE_PRICE_DAYS * 24 * 60 * 60 * 1000;
        for (const row of data as Array<{ last_synced_at: string | null }>) {
          totalListings++;
          const syncedAt = row.last_synced_at;
          if (syncedAt) {
            if (!lastSyncedAt || syncedAt > lastSyncedAt) lastSyncedAt = syncedAt;
            if (Date.parse(syncedAt) >= cutoff) freshListings++;
          }
        }
      } else if (error) {
        logger.warn('getMerchantSyncReliability: listings query failed', { error: error.message });
      }
    } catch {
      totalListings = 0;
      freshListings = 0;
      lastSyncedAt = null;
    }

    return insufficient(runs, totalListings, freshListings, lastSyncedAt);
  } catch (err) {
    logger.error('getMerchantSyncReliability: unexpected error', { error: String(err) });
    return insufficient([], 0, 0, null);
  }
}
