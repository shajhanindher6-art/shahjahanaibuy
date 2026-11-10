/**
 * Retailer price-accuracy audits (Section 5 #7).
 *
 * Sample-based framework only. The owner/admin records REAL checkout
 * observations (listing price vs the price actually charged at
 * checkout) in `price_accuracy_audits` (migration 028). This module
 * computes a per-retailer accuracy score from those recorded samples
 * — and NOTHING else:
 *
 *   * A sample "matches" when the checkout price is within 1% of the
 *     listing price (covers rounding / tax-line display differences,
 *     not a different price).
 *   * score = matched samples ÷ all samples × 100 (null when there
 *     are no samples — "No audits yet", never a guessed score).
 *   * "Caution" flag: score < 95% AND at least 5 samples. Fewer than
 *     5 samples is "insufficient samples", not a caution — a flag
 *     from 1–2 samples would be noise, not evidence.
 *   * Live checkout verification stays MANUAL (the owner enters the
 *     samples). No code here visits a checkout or fabricates a result.
 *
 * Fail-safe: readers return empty samples when the table is missing
 * (migration 028 not run yet), so the UI renders "No audits yet".
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Constants (public thresholds — stated in the UI, never a black box)
// ---------------------------------------------------------------------------

/** Checkout within this share of the listing price counts as a match. */
export const PRICE_MATCH_TOLERANCE = 0.01;
/** Below this score a retailer is flagged "Caution" (with enough samples). */
export const ACCURACY_CAUTION_THRESHOLD = 95;
/** Minimum samples before a Caution flag may be raised. */
export const ACCURACY_MIN_SAMPLES_FOR_CAUTION = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccuracySample {
  id: string;
  merchantId: string;
  productId: string | null;
  listingPrice: number;
  checkoutPrice: number;
  currency: string;
  checkedAt: string;
  sampleSource: string;
  notes: string | null;
}

export interface AccuracyCheck {
  /** Null when there are no recorded samples. */
  score: number | null;
  sampleCount: number;
  matchCount: number;
  mismatchCount: number;
  /** True only when score < 95% with >= 5 samples. */
  caution: boolean;
  /** True when there are too few samples to judge either way. */
  insufficientSamples: boolean;
  /** Public-facing status label. */
  status: 'ok' | 'caution' | 'insufficient';
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

/** Absolute + relative difference between listing and checkout price. */
export function computeAccuracy(input: {
  listingPrice: number;
  checkoutPrice: number;
}): { difference: number; differencePct: number; matches: boolean } {
  const difference = input.checkoutPrice - input.listingPrice;
  const differencePct =
    input.listingPrice === 0 ? 0 : (difference / input.listingPrice) * 100;
  const matches = Math.abs(differencePct) <= PRICE_MATCH_TOLERANCE * 100;
  return { difference, differencePct, matches };
}

/**
 * Per-retailer accuracy score from recorded audit samples only.
 * No samples → score null ("No audits yet").
 */
export function accuracyScore(samples: AccuracySample[]): AccuracyCheck {
  const sampleCount = samples.length;
  if (sampleCount === 0) {
    return {
      score: null,
      sampleCount: 0,
      matchCount: 0,
      mismatchCount: 0,
      caution: false,
      insufficientSamples: true,
      status: 'insufficient',
      reasons: [
        'No audits yet — no listing-vs-checkout samples have been recorded for this retailer.',
      ],
    };
  }

  const matchCount = samples.filter(
    (s) => computeAccuracy({ listingPrice: s.listingPrice, checkoutPrice: s.checkoutPrice }).matches
  ).length;
  const mismatchCount = sampleCount - matchCount;
  const score = Math.round((matchCount / sampleCount) * 100);
  const insufficientSamples = sampleCount < ACCURACY_MIN_SAMPLES_FOR_CAUTION;
  const caution = !insufficientSamples && score < ACCURACY_CAUTION_THRESHOLD;

  const reasons: string[] = [
    `${matchCount} of ${sampleCount} recorded checkout samples matched the listing price (within 1%).`,
  ];
  if (caution) {
    reasons.push(
      `Accuracy ${score}% is below the ${ACCURACY_CAUTION_THRESHOLD}% bar — treat this retailer's listed prices with caution until more samples are recorded.`
    );
  } else if (insufficientSamples) {
    reasons.push(
      `Only ${sampleCount} sample${sampleCount === 1 ? '' : 's'} recorded — too few to judge; at least ${ACCURACY_MIN_SAMPLES_FOR_CAUTION} are needed before a Caution flag can be raised.`
    );
  } else {
    reasons.push(
      `Accuracy ${score}% meets the ${ACCURACY_CAUTION_THRESHOLD}% bar across ${sampleCount} samples.`
    );
  }

  return {
    score,
    sampleCount,
    matchCount,
    mismatchCount,
    caution,
    insufficientSamples,
    status: caution ? 'caution' : insufficientSamples ? 'insufficient' : 'ok',
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Fail-safe reads / writes
// ---------------------------------------------------------------------------

const AUDIT_COLUMNS =
  'id, merchant_id, product_id, listing_price, checkout_price, currency, checked_at, sample_source, notes';

function mapAudit(row: Record<string, unknown>): AccuracySample {
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id),
    productId: row.product_id === null ? null : String(row.product_id),
    listingPrice: Number(row.listing_price),
    checkoutPrice: Number(row.checkout_price),
    currency: String(row.currency ?? 'USD'),
    checkedAt: String(row.checked_at),
    sampleSource: String(row.sample_source ?? 'manual'),
    notes: row.notes === null ? null : String(row.notes),
  };
}

/**
 * Recorded audit samples for one merchant (newest first). Returns []
 * when the table is missing or the query fails.
 */
export async function getAccuracySamples(
  supabase: AnySupabaseClient,
  merchantId: string,
  limit = 50
): Promise<AccuracySample[]> {
  try {
    const { data, error } = await supabase
      .from('price_accuracy_audits')
      .select(AUDIT_COLUMNS)
      .eq('merchant_id', merchantId)
      .order('checked_at', { ascending: false })
      .limit(Math.min(200, Math.max(1, limit)));

    if (error || !data) {
      if (error) logger.warn('getAccuracySamples: query failed', { error: error.message });
      return [];
    }
    return (data as unknown as Record<string, unknown>[]).map(mapAudit);
  } catch (err) {
    logger.error('getAccuracySamples: unexpected error', { error: String(err) });
    return [];
  }
}

/**
 * Record one audit sample (admin-entered, from a real checkout
 * observation). Returns the created sample, or null on failure.
 */
export async function recordAccuracySample(
  supabase: AnySupabaseClient,
  checkedBy: string,
  input: {
    merchantId: string;
    productId?: string | null;
    listingPrice: number;
    checkoutPrice: number;
    currency?: string;
    notes?: string | null;
  }
): Promise<AccuracySample | null> {
  try {
    const { data, error } = await supabase
      .from('price_accuracy_audits')
      .insert({
        merchant_id: input.merchantId,
        product_id: input.productId ?? null,
        listing_price: input.listingPrice,
        checkout_price: input.checkoutPrice,
        currency: input.currency ?? 'USD',
        checked_by: checkedBy,
        sample_source: 'manual',
        notes: input.notes ?? null,
      })
      .select(AUDIT_COLUMNS)
      .single();

    if (error || !data) {
      if (error) logger.warn('recordAccuracySample: insert failed', { error: error.message });
      return null;
    }
    return mapAudit(data as unknown as Record<string, unknown>);
  } catch (err) {
    logger.error('recordAccuracySample: unexpected error', { error: String(err) });
    return null;
  }
}
