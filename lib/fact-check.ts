/**
 * Deal fact-checking pipeline (Section 5 #16).
 *
 * Two stages, kept strictly separate:
 *
 *   1. AUTOMATED CHECKS (pure, deterministic, in this file). They run
 *      over numbers the admin supplied from real observations —
 *      listing price, compare-at price, checkout price, recent lowest
 *      price, history depth, and whether the merchant carries a price-
 *      accuracy Caution flag. The code never invents a price, a match,
 *      or a verdict: a check with no input data is "inconclusive",
 *      never "passed".
 *   2. HUMAN REVIEW (the admin queue). An admin approves, rejects, or
 *      takes a deal down. A takedown also deactivates the deal itself
 *      (the API route does that and reports whether it happened).
 *
 * Public meaning of "Verified" is published text (below), so shoppers
 * always know exactly what the badge does — and does not — mean.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Public meaning of "Verified" (rendered verbatim in the UI / API)
// ---------------------------------------------------------------------------

export const DEAL_VERIFIED_MEANING =
  'A "Verified" deal passed SmartBuy’s fact-checking: automated checks confirmed the ' +
  'listed price against the checkout price (where a checkout sample exists), the ' +
  'discount against the recorded price history, and the retailer’s reliability — and a ' +
  'human reviewer then approved it. "Verified" means the deal was checked at review ' +
  'time; it is not a guarantee the price is still live, and it never means SmartBuy ' +
  'sells the product. A deal that fails a check, or has too little data to check, is ' +
  'never shown as Verified.';

export const DEAL_TAKEDOWN_POLICY =
  'A deal is taken down immediately when a check fails on real evidence (for example ' +
  'the checkout price does not match the listing) or a reviewer finds the deal ' +
  'misleading. Taken-down deals are removed from listings the same day and are not ' +
  'shown as deals again until they pass a fresh fact-check.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FactCheckStatus = 'pending' | 'approved' | 'rejected' | 'taken_down';
export type FactCheckOverall = 'pass' | 'fail' | 'inconclusive';
export type FactCheckOutcome = 'pass' | 'fail' | 'inconclusive';

export interface FactCheckInput {
  /** Price shown on the listing (required for any price check). */
  listingPrice: number | null;
  /** "Was" / compare-at price the discount is claimed against. */
  compareAtPrice?: number | null;
  /** Price actually charged at checkout (manual sample only). */
  checkoutPrice?: number | null;
  /** Lowest recorded price in recent history. */
  historyLowest?: number | null;
  /** Number of recorded price-history points behind historyLowest. */
  historyPoints?: number | null;
  /** True when the merchant carries a price-accuracy Caution flag. */
  merchantCaution?: boolean;
}

export interface AutomatedCheck {
  key: 'price_match' | 'discount_real' | 'history_depth' | 'merchant_reliability';
  label: string;
  outcome: FactCheckOutcome;
  detail: string;
}

export interface AutomatedCheckResult {
  checks: AutomatedCheck[];
  overall: FactCheckOverall;
}

export type FactCheckSubjectType = 'deal' | 'community_deal' | 'product' | 'manual';

export interface FactCheckRow {
  id: string;
  subjectType: FactCheckSubjectType;
  subjectId: string;
  subjectTitle: string;
  listingPrice: number | null;
  compareAtPrice: number | null;
  checkoutPrice: number | null;
  historyLowest: number | null;
  historyPoints: number | null;
  merchantCaution: boolean;
  checks: AutomatedCheck[];
  overall: FactCheckOverall;
  status: FactCheckStatus;
  reviewerId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Pure automated checks
// ---------------------------------------------------------------------------

/**
 * Run the automated checks over admin-supplied real observations.
 * Rules (all deterministic, all stated in the check detail):
 *   * price_match — checkout within 1% of listing → pass; differs by
 *     more → fail; no checkout sample → inconclusive (never a pass).
 *   * discount_real — listing above compare-at → fail (the claimed
 *     discount is false); listing above 125% of the recent lowest →
 *     fail (nowhere near a real low); listing below compare-at and
 *     at/below 105% of the recent lowest → pass; otherwise
 *     inconclusive.
 *   * history_depth — ≥5 recorded points → pass; fewer → inconclusive
 *     (thin history is not a failure, just not enough to judge).
 *   * merchant_reliability — merchant Caution flag → fail; no flag →
 *     pass (the flag is the only reliability signal used here).
 * Overall: fail if any check fails; pass ONLY when both substantive
 * price checks (listing-vs-checkout and discount-vs-history) pass;
 * otherwise inconclusive — a "pass" never rests on a check that had
 * no data behind it.
 */
export function runAutomatedChecks(input: FactCheckInput): AutomatedCheckResult {
  const checks: AutomatedCheck[] = [];

  // 1. Listing vs checkout price.
  if (input.listingPrice !== null && input.checkoutPrice !== null && input.checkoutPrice !== undefined) {
    const diffPct =
      input.listingPrice === 0
        ? 0
        : ((input.checkoutPrice - input.listingPrice) / input.listingPrice) * 100;
    const matches = Math.abs(diffPct) <= 1;
    checks.push({
      key: 'price_match',
      label: 'Listing price matches checkout price',
      outcome: matches ? 'pass' : 'fail',
      detail: matches
        ? `Checkout price matches the listing price (within 1%, difference ${diffPct.toFixed(2)}%).`
        : `Checkout price differs from the listing price by ${diffPct.toFixed(2)}% — the listed price is not what shoppers are charged.`,
    });
  } else {
    checks.push({
      key: 'price_match',
      label: 'Listing price matches checkout price',
      outcome: 'inconclusive',
      detail: 'No checkout price sample was supplied, so the listing price could not be checked against checkout.',
    });
  }

  // 2. Discount claim vs compare-at + recorded history.
  const listing = input.listingPrice;
  const compareAt = input.compareAtPrice ?? null;
  const lowest = input.historyLowest ?? null;
  if (listing !== null && compareAt !== null) {
    if (listing > compareAt) {
      checks.push({
        key: 'discount_real',
        label: 'Discount is real',
        outcome: 'fail',
        detail: `The listing price is higher than the compare-at price it claims to be discounted from — the discount claim is false.`,
      });
    } else if (lowest !== null && listing > lowest * 1.25) {
      checks.push({
        key: 'discount_real',
        label: 'Discount is real',
        outcome: 'fail',
        detail: `The price is more than 25% above the lowest recorded price — it is nowhere near a real low, so the "deal" is not supported by history.`,
      });
    } else if (lowest === null || listing <= lowest * 1.05) {
      checks.push({
        key: 'discount_real',
        label: 'Discount is real',
        outcome: 'pass',
        detail:
          lowest === null
            ? 'The price is below the compare-at price; no recorded history was supplied to cross-check it against.'
            : 'The price is below the compare-at price and within 5% of the lowest recorded price.',
      });
    } else {
      checks.push({
        key: 'discount_real',
        label: 'Discount is real',
        outcome: 'inconclusive',
        detail: 'The price is below the compare-at price but above the recent lowest — the discount is plausible, not proven.',
      });
    }
  } else {
    checks.push({
      key: 'discount_real',
      label: 'Discount is real',
      outcome: 'inconclusive',
      detail: 'No compare-at price was supplied, so the discount claim could not be checked.',
    });
  }

  // 3. History depth.
  const points = input.historyPoints ?? null;
  if (points !== null && points !== undefined) {
    checks.push({
      key: 'history_depth',
      label: 'Enough price history to judge',
      outcome: points >= 5 ? 'pass' : 'inconclusive',
      detail:
        points >= 5
          ? `${points} recorded price points support the history check.`
          : `Only ${points} recorded price point${points === 1 ? '' : 's'} — too few to judge the history, so this check is inconclusive, not a failure.`,
    });
  } else {
    checks.push({
      key: 'history_depth',
      label: 'Enough price history to judge',
      outcome: 'inconclusive',
      detail: 'No price-history depth was supplied, so the history check is inconclusive.',
    });
  }

  // 4. Merchant reliability (Caution flag from price-accuracy audits).
  if (input.merchantCaution) {
    checks.push({
      key: 'merchant_reliability',
      label: 'Retailer reliability',
      outcome: 'fail',
      detail: 'The retailer carries a price-accuracy Caution flag (accuracy below 95% across 5+ recorded audits).',
    });
  } else {
    checks.push({
      key: 'merchant_reliability',
      label: 'Retailer reliability',
      outcome: 'pass',
      detail: 'The retailer carries no price-accuracy Caution flag.',
    });
  }

  // Overall: fail if any check fails; pass ONLY when both substantive
  // price checks (listing-vs-checkout and discount-vs-history) pass —
  // a "pass" must never rest on the reliability check alone, or on
  // checks that were inconclusive for lack of data. Anything else is
  // inconclusive, and a human reviewer decides.
  const priceMatch = checks.find((c) => c.key === 'price_match')?.outcome;
  const discountReal = checks.find((c) => c.key === 'discount_real')?.outcome;
  const overall: FactCheckOverall = checks.some((c) => c.outcome === 'fail')
    ? 'fail'
    : priceMatch === 'pass' && discountReal === 'pass'
      ? 'pass'
      : 'inconclusive';

  return { checks, overall };
}

// ---------------------------------------------------------------------------
// Fail-safe reads (admin queue)
// ---------------------------------------------------------------------------

const FACT_CHECK_COLUMNS =
  'id, subject_type, subject_id, subject_title, listing_price, compare_at_price, checkout_price, history_lowest, history_points, merchant_caution, checks, overall, status, reviewer_id, reviewed_at, review_note, created_at, updated_at';

function mapFactCheck(row: Record<string, unknown>): FactCheckRow {
  const checksRaw = row.checks;
  const checks: AutomatedCheck[] = Array.isArray(checksRaw)
    ? (checksRaw as AutomatedCheck[])
    : [];
  const overall: FactCheckOverall =
    row.overall === 'pass' || row.overall === 'fail' ? row.overall : 'inconclusive';
  const status: FactCheckStatus =
    row.status === 'approved' || row.status === 'rejected' || row.status === 'taken_down'
      ? row.status
      : 'pending';
  return {
    id: String(row.id),
    subjectType: (row.subject_type as FactCheckSubjectType) ?? 'manual',
    subjectId: String(row.subject_id),
    subjectTitle: String(row.subject_title),
    listingPrice: row.listing_price === null ? null : Number(row.listing_price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    checkoutPrice: row.checkout_price === null ? null : Number(row.checkout_price),
    historyLowest: row.history_lowest === null ? null : Number(row.history_lowest),
    historyPoints: row.history_points === null ? null : Number(row.history_points),
    merchantCaution: row.merchant_caution === true,
    checks,
    overall,
    status,
    reviewerId: row.reviewer_id === null ? null : String(row.reviewer_id),
    reviewedAt: row.reviewed_at === null ? null : String(row.reviewed_at),
    reviewNote: row.review_note === null ? null : String(row.review_note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Admin review queue (optionally filtered by status). Returns [] when
 * the table is missing or the query fails — the admin page then shows
 * its honest empty state.
 */
export async function getFactCheckQueue(
  supabase: AnySupabaseClient,
  status?: FactCheckStatus
): Promise<FactCheckRow[]> {
  try {
    let query = supabase
      .from('deal_fact_checks')
      .select(FACT_CHECK_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(100);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error || !data) {
      if (error) logger.warn('getFactCheckQueue: query failed', { error: error.message });
      return [];
    }
    return (data as unknown as Record<string, unknown>[]).map(mapFactCheck);
  } catch (err) {
    logger.error('getFactCheckQueue: unexpected error', { error: String(err) });
    return [];
  }
}

/** One queue entry by id, or null. */
export async function getFactCheck(
  supabase: AnySupabaseClient,
  id: string
): Promise<FactCheckRow | null> {
  try {
    const { data, error } = await supabase
      .from('deal_fact_checks')
      .select(FACT_CHECK_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getFactCheck: query failed', { error: error.message });
      return null;
    }
    return mapFactCheck(data as unknown as Record<string, unknown>);
  } catch (err) {
    logger.error('getFactCheck: unexpected error', { error: String(err) });
    return null;
  }
}
