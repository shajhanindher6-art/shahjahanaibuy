/**
 * Section 20, §12 #39 / #44 — price-history quality: provenance,
 * coverage, per-source reliability, and suspicious-change flags.
 *
 * `price_history` (migration 002) records a price, a retailer and
 * a timestamp — nothing about WHERE the price came from, whether
 * the move that produced it looked abnormal, or how much history
 * a product even has. Migration 057 adds the three columns this
 * module writes (`source`, `observed_at`, `suspicious_change`);
 * until 057 is applied, `insertPriceHistoryRow` retries without
 * them (Postgres 42703 — the same fail-safe pattern as
 * services/products.ts:115-130), so a write never fails over an
 * unapplied migration.
 *
 * Provenance values (`PRICE_HISTORY_SOURCES`) are the only
 * sources a row may claim. A DB re-read (services/price-refresh)
 * records NO source (null): it re-records a stored merchant
 * price whose origin is not tracked, and claiming `seed` or
 * `manual-intake` for it would invent provenance. The pipeline
 * records `merchant-feed` (arrived through a provider fetch);
 * the seed backfill in 057 labels the pre-existing rows `seed`.
 *
 * "Suspicious" is a pattern flag, never an accusation: the same
 * pure detectors the product page already displays
 * (services/fake-sale.ts, services/inflation-check.ts, plus the
 * 25% single-step spike bar from services/trust-signals.ts) run
 * at ingestion time, and a flagged row is still stored — flagged,
 * not silently inserted as normal, and never dropped.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { detectFakeSale } from './fake-sale';
import { checkPriceInflation } from './inflation-check';
import { TIME_SERIES_SPIKE_THRESHOLD } from './trust-signals';

/** Provenance a price_history row may claim (migration 057 CHECK). */
export const PRICE_HISTORY_SOURCES = [
  'seed',
  'live',
  'manual-intake',
  'ebay-browse-api',
  'merchant-feed',
] as const;

export type PriceHistorySource = (typeof PRICE_HISTORY_SOURCES)[number];

export interface PriceHistoryPoint {
  price: number;
  /** ISO timestamp of the recording. */
  recordedAt: string;
  /** Migration 057 source, or null when the row claims none. */
  source?: string | null;
  /** Migration 057 flag, or null when the column predates it. */
  suspicious?: boolean | null;
}

export interface HistoryCoverage {
  /** Recorded points counted. */
  points: number;
  /** Whole days between the earliest and latest point (0 for <2 points). */
  spanDays: number;
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-product history coverage: how many points, over what span. */
export function computeHistoryCoverage(points: PriceHistoryPoint[]): HistoryCoverage {
  const usable = points
    .map((p) => ({ price: p.price, time: new Date(p.recordedAt).getTime() }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (usable.length === 0) {
    return { points: 0, spanDays: 0, firstRecordedAt: null, lastRecordedAt: null };
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  return {
    points: usable.length,
    spanDays: Math.max(0, Math.round((last.time - first.time) / DAY_MS)),
    firstRecordedAt: new Date(first.time).toISOString(),
    lastRecordedAt: new Date(last.time).toISOString(),
  };
}

export interface SourceReliability {
  /** Points recorded from this source. */
  points: number;
  /** Points flagged suspicious. */
  suspicious: number;
  /**
   * Share of non-suspicious points (0–1), or null when the source
   * has no points. This is a recorded-history ratio, not a trust
   * score — a source with 1 clean point scores 1.0, which means
   * "nothing flagged yet", not "proven reliable".
   */
  reliability: number | null;
}

/**
 * Per-source reliability from price_history rows: group by
 * `source` (rows with no source group under `"unknown"`) and
 * count points vs flagged points. Pure — it reads rows the
 * caller supplies, never the DB.
 */
export function computeSourceReliability(
  rows: PriceHistoryPoint[]
): Record<string, SourceReliability> {
  const bySource = new Map<string, { points: number; suspicious: number }>();
  for (const row of rows) {
    const source = row.source ?? 'unknown';
    const entry = bySource.get(source) ?? { points: 0, suspicious: 0 };
    entry.points += 1;
    if (row.suspicious === true) entry.suspicious += 1;
    bySource.set(source, entry);
  }
  const out: Record<string, SourceReliability> = {};
  for (const [source, entry] of bySource) {
    out[source] = {
      points: entry.points,
      suspicious: entry.suspicious,
      reliability:
        entry.points === 0 ? null : Math.round(((entry.points - entry.suspicious) / entry.points) * 1000) / 1000,
    };
  }
  return out;
}

export interface PriceChangeAssessment {
  /** True when any detector flagged the new point. */
  suspicious: boolean;
  /** One factual reason per detector that fired. */
  reasons: string[];
  /** Coverage of the history the assessment ran on (incl. the new point). */
  coverage: HistoryCoverage;
  /** Single-step move vs the previous point, as a fraction (null when <2 points). */
  spikePct: number | null;
  fakeSaleAlert: boolean;
  inflationVerdict: 'fake_discount_pattern' | 'inflated' | 'no_pattern' | 'insufficient';
}

/**
 * Assess a new price against the product's recorded history
 * BEFORE it is inserted. Runs, in order:
 *  (1) single-step spike — |new - previous| / previous at or
 *      above the 25% trust-signals bar;
 *  (2) fake-sale pattern — rise ≥10% then a drop to a price not
 *      below the pre-rise low (services/fake-sale.ts);
 *  (3) sustained inflation — rise ≥10% in 30 days, still at/near
 *      the max (services/inflation-check.ts).
 * A flagged point is stored with `suspicious_change = true` —
 * flagged, not dropped and not silently recorded as normal.
 */
export function assessPriceChange(
  history: PriceHistoryPoint[],
  newPrice: number,
  newRecordedAt: string
): PriceChangeAssessment {
  const points: PriceHistoryPoint[] = [
    ...history,
    { price: newPrice, recordedAt: newRecordedAt },
  ];
  const coverage = computeHistoryCoverage(points);
  const reasons: string[] = [];

  const usable = points
    .map((p) => ({ price: p.price, time: new Date(p.recordedAt).getTime() }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);

  let spikePct: number | null = null;
  if (usable.length >= 2) {
    const previous = usable[usable.length - 2];
    const latest = usable[usable.length - 1];
    spikePct = Math.round(((latest.price - previous.price) / previous.price) * 1000) / 1000;
    if (Math.abs(spikePct) >= TIME_SERIES_SPIKE_THRESHOLD) {
      const pct = Math.round(Math.abs(spikePct) * 100);
      const direction = spikePct > 0 ? 'rose' : 'fell';
      reasons.push(
        `Price ${direction} ${pct}% in one recorded step ($${previous.price.toFixed(2)} → $${latest.price.toFixed(2)})`
      );
    }
  }

  const fakeSale = detectFakeSale(
    usable.map((p) => ({ price: p.price, recordedAt: new Date(p.time).toISOString() }))
  );
  if (fakeSale.alert && fakeSale.explanation) {
    reasons.push(fakeSale.explanation);
  }

  const inflation = checkPriceInflation(
    usable.map((p) => ({ price: p.price, recordedAt: new Date(p.time).toISOString() }))
  );
  if (
    (inflation.verdict === 'fake_discount_pattern' || inflation.verdict === 'inflated') &&
    !reasons.some((r) => r.includes('raised just before this sale'))
  ) {
    reasons.push(inflation.reason);
  }

  return {
    suspicious: reasons.length > 0,
    reasons,
    coverage,
    spikePct,
    fakeSaleAlert: fakeSale.alert,
    inflationVerdict: inflation.verdict,
  };
}

// ---------------------------------------------------------------------------
// Insert with a 42703 fail-safe (migration 057 unapplied)
// ---------------------------------------------------------------------------

/** PostgREST/Postgres code for "column does not exist". */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

export interface PriceHistoryInsert {
  product_id: string;
  retailer_id: string;
  price: number;
  /** 3-letter currency code, resolved from the row's currency_id (§12 #41). */
  currency: string;
  availability: string;
  url?: string | null;
  recorded_at?: string;
  /** Migration 057 provenance — null claims none (see module header). */
  source?: PriceHistorySource | null;
  /** Migration 057: when the price was observed (defaults to recorded_at). */
  observed_at?: string;
  /** Migration 057 flag from `assessPriceChange`. */
  suspicious_change?: boolean;
}

/**
 * Insert one price_history row. Tries the migration-057 columns
 * first; when the live table predates 057 PostgREST answers
 * 42703 and the insert retries with only the migration-002
 * columns — the row is still recorded, just without provenance
 * or a flag. A transport throw propagates (callers treat it as
 * a failed insert); any other insert error is returned.
 */
export async function insertPriceHistoryRow(
  supabase: AnySupabaseClient,
  row: PriceHistoryInsert
): Promise<{ error: { message: string; code?: string } | null }> {
  const recordedAt = row.recorded_at ?? new Date().toISOString();
  const fullRow: Record<string, unknown> = {
    product_id: row.product_id,
    retailer_id: row.retailer_id,
    price: row.price,
    currency: row.currency,
    availability: row.availability,
    url: row.url ?? null,
    recorded_at: recordedAt,
    source: row.source ?? null,
    observed_at: row.observed_at ?? recordedAt,
    suspicious_change: row.suspicious_change ?? false,
  };
  const { error } = (await supabase.from('price_history').insert(fullRow)) as {
    error: { message: string; code?: string } | null;
  };
  if (error && isUndefinedColumnError(error)) {
    const legacyRow: Record<string, unknown> = {
      product_id: row.product_id,
      retailer_id: row.retailer_id,
      price: row.price,
      currency: row.currency,
      availability: row.availability,
      url: row.url ?? null,
      recorded_at: recordedAt,
    };
    const retry = (await supabase.from('price_history').insert(legacyRow)) as {
      error: { message: string; code?: string } | null;
    };
    return { error: retry.error };
  }
  return { error };
}
