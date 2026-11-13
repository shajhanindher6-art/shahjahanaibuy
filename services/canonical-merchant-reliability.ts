/**
 * FINAL 100% — ONE canonical merchant-reliability scorer
 * (F-P1-50, F-P1-48).
 *
 * The collision (audit Worker H §6, Worker I I-13): THREE things
 * were called "merchant reliability", plus a fourth string-key
 * use:
 *   1. POLICY scorer — services/merchant-reliability.ts
 *      (directory + website + Verified Merchant badge + trust
 *      grade + listing depth). Live callers: ai-comparison.ts
 *      (compare page) and provider-status.ts (/admin/ai panel).
 *   2. SYNC scorer — services/merchant-reliability-score.ts
 *      (refresh-run health + fresh-listing share + listing
 *      depth). Live caller: ai-deals.ts (deal ranking, -10
 *      penalty on scored `low`).
 *   3. HISTORY-based `computeSourceReliability` —
 *      services/price-history-quality.ts (share of
 *      non-suspicious price_history points per source). Computed
 *      by the admin data-quality service, unrendered. It is a
 *      PER-SOURCE price-history reliability, not a merchant
 *      score — the name is the only collision.
 *   4. Fact-check criterion key 'merchant_reliability' —
 *      lib/fact-check.ts (a string key for a Caution-flag check,
 *      not a score at all).
 *
 * THE CANONICAL SCORER IS (1), THE POLICY SCORER. It is the only
 * scorer whose inputs exist today for every merchant (directory
 * + website + listings), and it is the one already wired into
 * both merchant surfaces. This module is the single entry point
 * for it:
 * - `getCanonicalMerchantReliability` — the policy scorer, for
 *   every merchant surface. New merchant surfaces must call
 *   this, never either scorer directly.
 * - `getDashboardMerchantReliability` — the dashboard data layer
 *   (the dashboard page itself is another worker's): one row per
 *   merchant with the canonical (policy) score AND the other two
 *   dimensions, each labelled with its dimension, so the page can
 *   render them without conflating them.
 * - `writeMerchantReliabilitySnapshot` / `readMerchantReliabilitySnapshot`
 *   (F-P1-48) — the writer for migration 061's
 *   `merchant_reliability` table: writes the canonical score
 *   when the table exists, returns honest "not written — table
 *   missing (061 not applied)" otherwise. The sync score is
 *   stored alongside in `signals` as a labelled dimension, never
 *   as a second score column.
 *
 * The other two scorers are NOT deleted: both have live callers
 * (audit §3 R-6), and deleting them would break the compare page
 * and deal ranking. They are documented here and in their own
 * file headers as supporting dimensions, and no third scorer may
 * be added (see the canonical-scorer notes in both files).
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  getMerchantReliability,
  type MerchantDirectoryRow,
  type MerchantReliability,
} from './merchant-reliability';
import {
  getMerchantSyncReliability,
  type MerchantSyncReliability,
} from './merchant-reliability-score';
import {
  computeSourceReliability,
  type PriceHistoryPoint,
  type SourceReliability,
} from './price-history-quality';

/** The ONE canonical merchant-reliability scorer. */
export const CANONICAL_MERCHANT_RELIABILITY_SCORER = 'policy' as const;
/** Supporting dimension: sync/freshness (deal ranking only). */
export const SYNC_RELIABILITY_DIMENSION = 'sync' as const;
/** Supporting dimension: per-source price-history reliability (NOT a merchant score). */
export const HISTORY_RELIABILITY_DIMENSION = 'price-history-source' as const;

/**
 * Canonical merchant reliability: the POLICY scorer. New
 * merchant surfaces must use this — never the sync scorer or
 * the history-based function — for "merchant reliability".
 */
export async function getCanonicalMerchantReliability(
  supabase: AnySupabaseClient,
  merchant: MerchantDirectoryRow
): Promise<MerchantReliability> {
  return getMerchantReliability(supabase, merchant);
}

export interface DashboardMerchantReliabilityRow {
  merchantId: string;
  merchantName: string;
  /** Which scorer is canonical for the "merchant reliability" label. */
  canonicalScorer: typeof CANONICAL_MERCHANT_RELIABILITY_SCORER;
  /** Canonical (policy) score — the "merchant reliability" number. */
  canonical: MerchantReliability;
  /** Supporting dimension: sync/freshness score (deal ranking). */
  sync: MerchantSyncReliability;
  /** Supporting dimension: per-source price-history reliability (NOT a merchant score). */
  historyBySource: Record<string, SourceReliability>;
}

/**
 * Dashboard data layer for merchant reliability (F-P1-50). One
 * row per merchant, canonical score first, supporting dimensions
 * labelled. The dashboard page renders `canonical` as "Merchant
 * reliability" and the other two under their own labels. Never
 * throws: a failed merchant read yields an empty row list with
 * the failure logged.
 */
export async function getDashboardMerchantReliability(
  supabase: AnySupabaseClient,
  historyPoints: PriceHistoryPoint[] = []
): Promise<DashboardMerchantReliabilityRow[]> {
  const historyBySource = computeSourceReliability(historyPoints);
  let merchants: MerchantDirectoryRow[] = [];
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id, name, website_url, active')
      .is('deleted_at', null)
      .limit(200);
    if (error || !data) {
      logger.warn('getDashboardMerchantReliability: merchants read failed', {
        error: error?.message,
      });
      return [];
    }
    merchants = (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      websiteUrl: typeof row.website_url === 'string' ? row.website_url : null,
      active: row.active !== false,
    }));
  } catch (err) {
    logger.warn('getDashboardMerchantReliability: unexpected failure', { error: String(err) });
    return [];
  }
  const rows: DashboardMerchantReliabilityRow[] = [];
  for (const merchant of merchants) {
    const [canonical, sync] = await Promise.all([
      getCanonicalMerchantReliability(supabase, merchant),
      getMerchantSyncReliability(supabase, merchant.id, merchant.name),
    ]);
    rows.push({
      merchantId: merchant.id,
      merchantName: merchant.name,
      canonicalScorer: CANONICAL_MERCHANT_RELIABILITY_SCORER,
      canonical,
      sync,
      historyBySource,
    });
  }
  return rows;
}

export interface ReliabilitySnapshotWrite {
  /** True when a row was written to merchant_reliability. */
  written: boolean;
  /** '061-not-applied' when the table does not exist yet. */
  reason: string | null;
  /** The canonical score that was (or would have been) written. */
  score: number | null;
  level: string;
}

/**
 * Writer for migration 061's `merchant_reliability` table
 * (F-P1-48). Computes the canonical (policy) score and upserts
 * one snapshot row per merchant; the sync score rides along in
 * `signals` as a labelled dimension. Writes when the columns
 * exist; honest null otherwise — a missing table (061 not
 * applied) returns written:false with the reason named, never
 * throws, never invents a score.
 */
export async function writeMerchantReliabilitySnapshot(
  supabase: AnySupabaseClient,
  merchant: MerchantDirectoryRow
): Promise<ReliabilitySnapshotWrite> {
  const canonical = await getCanonicalMerchantReliability(supabase, merchant);
  const sync = await getMerchantSyncReliability(supabase, merchant.id, merchant.name);
  const signals = [
    ...canonical.signals.map((s) => ({
      key: s.key,
      label: s.label,
      present: s.present,
      detail: s.detail,
      dimension: CANONICAL_MERCHANT_RELIABILITY_SCORER,
    })),
    {
      key: 'sync_reliability',
      label: 'Sync reliability (supporting dimension — deal ranking)',
      present: sync.score !== null,
      detail: sync.explanation,
      dimension: SYNC_RELIABILITY_DIMENSION,
      score: sync.score,
    },
  ];
  try {
    const { error } = await supabase.from('merchant_reliability').upsert(
      {
        merchant_id: merchant.id,
        score: canonical.score,
        level: canonical.level,
        status: canonical.notEnoughData ? 'insufficient-data' : 'scored',
        signals,
        explanation: canonical.explanation,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'merchant_id' }
    );
    if (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'PGRST205' || code === '42P01') {
        return {
          written: false,
          reason: 'merchant_reliability table missing — migration 061 not applied; score stays computed at read time',
          score: canonical.score,
          level: canonical.level,
        };
      }
      logger.warn('writeMerchantReliabilitySnapshot: upsert failed', { error: error.message });
      return { written: false, reason: error.message, score: canonical.score, level: canonical.level };
    }
    return { written: true, reason: null, score: canonical.score, level: canonical.level };
  } catch (err) {
    logger.warn('writeMerchantReliabilitySnapshot: unexpected failure', { error: String(err) });
    return { written: false, reason: String(err), score: canonical.score, level: canonical.level };
  }
}

export interface ReliabilitySnapshotRead {
  merchantId: string;
  score: number | null;
  level: string | null;
  status: 'scored' | 'insufficient-data' | null;
  explanation: string | null;
  computedAt: string | null;
  /** True when the table does not exist yet (061 not applied). */
  tableMissing: boolean;
}

/** Read a stored reliability snapshot; null score when none was ever written. */
export async function readMerchantReliabilitySnapshot(
  supabase: AnySupabaseClient,
  merchantId: string
): Promise<ReliabilitySnapshotRead> {
  const empty: ReliabilitySnapshotRead = {
    merchantId,
    score: null,
    level: null,
    status: null,
    explanation: null,
    computedAt: null,
    tableMissing: false,
  };
  try {
    const { data, error } = await supabase
      .from('merchant_reliability')
      .select('score, level, status, explanation, computed_at')
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'PGRST205' || code === '42P01') return { ...empty, tableMissing: true };
      logger.warn('readMerchantReliabilitySnapshot: read failed', { error: error.message });
      return empty;
    }
    if (!data) return empty;
    const row = data as Record<string, unknown>;
    return {
      merchantId,
      score: typeof row.score === 'number' ? row.score : null,
      level: typeof row.level === 'string' ? row.level : null,
      status:
        row.status === 'scored' || row.status === 'insufficient-data'
          ? row.status
          : null,
      explanation: typeof row.explanation === 'string' ? row.explanation : null,
      computedAt: typeof row.computed_at === 'string' ? row.computed_at : null,
      tableMissing: false,
    };
  } catch (err) {
    logger.warn('readMerchantReliabilitySnapshot: unexpected failure', { error: String(err) });
    return empty;
  }
}
