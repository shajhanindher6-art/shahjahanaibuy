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
  /**
   * FINAL 100% (F-P1-15) — per-row verification flag, or null
   * when the row predates the column. True only for a point
   * written from a validated provider response.
   */
  verified?: boolean | null;
  /**
   * FINAL 100% (F-P1-30) — true when the point's USD was assumed
   * from a NULL currency_id, never observed. Null when the row
   * predates the column.
   */
  currencyAssumed?: boolean | null;
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
 * FINAL 100% (W3, F-P1-32/F-P1-33) — the change-only dedupe every
 * history writer must apply before inserting: a re-ingest (or a
 * re-fetch) of the SAME price with the SAME availability is not a
 * new observation, it is the same observation recorded again.
 * `latest` is the newest recorded row for the (product, retailer)
 * pair, or null when none exists (first observation always
 * records). Prices compare numerically (stored values arrive as
 * strings from PostgREST); availability compares as recorded,
 * defaulting an absent value to 'unknown' — never to 'in_stock'.
 */
export function isDuplicatePricePoint(
  latest: { price: number | string; availability?: string | null } | null | undefined,
  price: number,
  availability?: string | null
): boolean {
  if (!latest) return false;
  const latestPrice = parseFloat(String(latest.price));
  if (!Number.isFinite(latestPrice) || !Number.isFinite(price)) return false;
  if (latestPrice !== price) return false;
  const latestAvailability = latest.availability ?? 'unknown';
  return latestAvailability === (availability ?? 'unknown');
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
  /**
   * Migration 072 region: the 2-letter region code the price
   * was observed in ('US' for Best Buy and eBay EBAY_US today).
   * Omit it (or pass null) when the region is unknown — the
   * writer falls back to `retailerCountry` below, and NULL
   * means "region unknown", never a guessed value. COLUMN
   * DEPENDENCY: `price_history.region` exists only once 072 is
   * applied; until then the tiered retry drops it and reports
   * `regionPersisted: false`.
   */
  region?: string | null;
  /**
   * The retailer's recorded country (`retailers.country`,
   * NOT NULL DEFAULT 'US' since migration 002) — the fallback
   * source for `region` when the caller did not observe a
   * region directly. A non-2-letter value is ignored (never
   * coerced into a region code). This is a lookup input, never
   * a stored column.
   */
  retailerCountry?: string | null;
  /** Migration 057 provenance — null claims none (see module header). */
  source?: PriceHistorySource | null;
  /**
   * Migration 057: when the price was observed. `undefined`
   * defaults to recorded_at (the old behaviour); an explicit
   * `null` is preserved as NULL — "observation time unknown" —
   * and must never be silently replaced with "now" (Sections
   * 21–25, Stage D, R3: a DB re-read is not an observation).
   */
  observed_at?: string | null;
  /** Migration 057 flag from `assessPriceChange`. */
  suspicious_change?: boolean;
  /**
   * FINAL 100% (W1, F-P1-15) — per-row verification flag. Pass
   * `true` ONLY for a row written from a validated provider
   * response; omit it (do not pass false) for re-reads and
   * unproven rows — absence means "not verified", and omitting
   * avoids a guaranteed 42703 retry on every insert while the
   * column does not exist. COLUMN DEPENDENCY: no migration
   * defines `price_history.verified` yet — it needs a future
   * migration (the 068–071 worker owns new migration files).
   * Until it exists, the staged retry below drops the flag and
   * reports `verifiedPersisted: false`.
   */
  verified?: boolean;
  /**
   * FINAL 100% (W1, F-P1-30) — true when the row's currency is USD
   * assumed from a NULL / unresolvable currency_id, never
   * observed. Omit it when the currency was genuinely observed
   * (same round-trip reason as `verified`). COLUMN DEPENDENCY:
   * same as `verified` — `price_history.currency_assumed` needs
   * a future migration; until then the flag is dropped by the
   * retry and reported as `currencyAssumedPersisted: false`, and
   * the run result's `currencyAssumedUsd` count is the only
   * record of the assumption.
   */
  currencyAssumed?: boolean;
}

export interface PriceHistoryInsertResult {
  error: { message: string; code?: string } | null;
  /** True when the `verified` flag reached the stored row. */
  verifiedPersisted: boolean;
  /** True when the `currency_assumed` flag reached the stored row. */
  currencyAssumedPersisted: boolean;
  /** True when the `region` value reached the stored row. */
  regionPersisted: boolean;
}

/**
 * Resolve the region for a price_history row. The caller's
 * explicit region wins; otherwise the retailer's recorded
 * country is used verbatim. Only a 2-letter code is accepted —
 * anything else (a full country name, an empty string, a
 * marketplace id like 'EBAY_US') resolves to null, "region
 * unknown", rather than a coerced or guessed value. Pure:
 * safe to call from tests and from the refresh route.
 */
export function resolvePriceRegion(input: {
  region?: string | null;
  retailerCountry?: string | null;
}): string | null {
  const raw = (input.region ?? input.retailerCountry ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

/**
 * Insert one price_history row. Tries the migration-057 columns
 * first; when the live table predates 057 PostgREST answers
 * 42703 and the insert retries with only the migration-002
 * columns — the row is still recorded, just without provenance
 * or a flag. A transport throw propagates (callers treat it as
 * a failed insert); any other insert error is returned.
 *
 * Final 100%, F-P1-58 — the insert also writes migration 060's
 * `currency_code` (the recorded 3-letter code, copied verbatim
 * from `currency`) when the column exists. The retry is tiered
 * so one missing column does not drop the others: a 42703 on
 * the full row retries without `currency_code` only (provenance
 * kept), and a second 42703 retries with the migration-002
 * columns only.
 *
 * Final 100%, F-P1-15 / F-P1-30 (W1) — the `verified` /
 * `currency_assumed` flags ride the same tiered retry as one
 * more layer, dropped FIRST (they exist in no migration yet):
 *   tier 1 — everything (060 code + 057 provenance + new flags,
 *            the flags included only when the caller passed them,
 *            so existing callers' inserts are byte-identical);
 *   tier 2 — without the new flags (060 code + 057 kept);
 *   tier 3 — without the 060 code either (057 provenance kept);
 *   tier 3b — without the region either (060 code + 057 kept),
 *            reached only when the caller wanted a region;
 *   tier 4 — migration-002 columns only.
 * The result reports whether each flag persisted, so a caller
 * can count dropped flags instead of assuming they landed.
 * (One exotic state is not covered: if the future verified /
 * currency_assumed migration were applied while 060 is NOT
 * applied, tier 3 drops the flags even though their columns
 * exist — the runbook applies migrations in numeric order, so
 * this cannot happen through the documented path, and the
 * dropped flags are reported, never silently kept.)
 *
 * Post-Integration Verification & Real Data Phase — the region
 * (migration 072) rides the same retry as one more layer,
 * dropped LAST but one: tier 1–3 carry it when the caller
 * wanted one, tier 3b drops it while keeping 060 + 057, and
 * tier 4 is the migration-002 fallback. A caller that passes
 * no region sees byte-identical inserts and identical attempt
 * counts to before — the region tiers are skipped entirely.
 */
export async function insertPriceHistoryRow(
  supabase: AnySupabaseClient,
  row: PriceHistoryInsert
): Promise<PriceHistoryInsertResult> {
  const recordedAt = row.recorded_at ?? new Date().toISOString();
  const wantsVerified = row.verified !== undefined;
  const wantsCurrencyAssumed = row.currencyAssumed !== undefined;
  const region = resolvePriceRegion({ region: row.region, retailerCountry: row.retailerCountry });
  const wantsRegion = region !== null;
  const notPersisted = {
    verifiedPersisted: false,
    currencyAssumedPersisted: false,
    regionPersisted: false,
  };
  const baseRow: Record<string, unknown> = {
    product_id: row.product_id,
    retailer_id: row.retailer_id,
    price: row.price,
    currency: row.currency,
    availability: row.availability,
    url: row.url ?? null,
    recorded_at: recordedAt,
  };
  const provenance: Record<string, unknown> = {
    source: row.source ?? null,
    // Sections 21–25, Stage D (R3): only `undefined` defaults
    // to recorded_at. An explicit null means "observation time
    // unknown" and is stored as NULL — a re-read must never
    // claim it observed the price "now".
    observed_at: row.observed_at === undefined ? recordedAt : row.observed_at,
    suspicious_change: row.suspicious_change ?? false,
  };
  const fullRow: Record<string, unknown> = {
    ...baseRow,
    // Final 100%, F-P1-58 — migration 060: the canonical
    // currency code, verbatim from the recorded `currency`
    // value. Never a converted or assumed code: the caller
    // resolved it from the row's currency_id (see
    // services/refresh-currency.ts).
    currency_code: row.currency,
    ...provenance,
    ...(wantsRegion ? { region } : {}),
    ...(wantsVerified ? { verified: row.verified } : {}),
    ...(wantsCurrencyAssumed ? { currency_assumed: row.currencyAssumed } : {}),
  };
  type InsertOutcome = { error: { message: string; code?: string } | null };
  const insertOnce = async (candidate: Record<string, unknown>): Promise<InsertOutcome> =>
    (await supabase.from('price_history').insert(candidate)) as InsertOutcome;

  // Tier 1 — everything.
  const tier1 = await insertOnce(fullRow);
  if (!tier1.error) {
    return {
      error: null,
      verifiedPersisted: wantsVerified,
      currencyAssumedPersisted: wantsCurrencyAssumed,
      regionPersisted: wantsRegion,
    };
  }
  if (!isUndefinedColumnError(tier1.error)) {
    return { error: tier1.error, ...notPersisted };
  }
  // Tier 2 — without the Final-100% flags only (060 + 057 +
  // region kept).
  // Skipped when the caller passed neither flag: the tier-1
  // failure is then necessarily a 060/057/072 column, and tier 3 is
  // the right next attempt (this keeps the pinned 2-attempt /
  // 3-attempt shapes for existing callers).
  if (wantsVerified || wantsCurrencyAssumed) {
    const tier2 = await insertOnce({
      ...baseRow,
      currency_code: row.currency,
      ...provenance,
      ...(wantsRegion ? { region } : {}),
    });
    if (!tier2.error) {
      return { error: null, ...notPersisted, regionPersisted: wantsRegion };
    }
    if (!isUndefinedColumnError(tier2.error)) {
      return { error: tier2.error, ...notPersisted };
    }
  }
  // Tier 3 — the 057 columns exist but `currency_code` (060)
  // does not: retry with provenance, without the code (region kept).
  const tier3 = await insertOnce({
    ...baseRow,
    ...provenance,
    ...(wantsRegion ? { region } : {}),
  });
  if (!tier3.error) {
    return { error: null, ...notPersisted, regionPersisted: wantsRegion };
  }
  if (!isUndefinedColumnError(tier3.error)) {
    return { error: tier3.error, ...notPersisted };
  }
  // Tier 3b — the region column (072) does not exist but 060 +
  // 057 do: retry with the code and provenance, without the
  // region. Reached only when the caller wanted a region; when
  // no region was wanted this tier is byte-identical to the
  // tier-2 shape and is skipped, so existing callers keep
  // their pinned attempt counts.
  if (wantsRegion) {
    const tier3b = await insertOnce({ ...baseRow, currency_code: row.currency, ...provenance });
    if (!tier3b.error) {
      return { error: null, ...notPersisted };
    }
    if (!isUndefinedColumnError(tier3b.error)) {
      return { error: tier3b.error, ...notPersisted };
    }
  }
  // Tier 4 — the table predates 057 entirely: legacy columns only.
  const tier4 = await insertOnce(baseRow);
  return { error: tier4.error, ...notPersisted };
}
