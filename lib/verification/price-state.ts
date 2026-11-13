/**
 * FINAL 100% Product & Real Data Completion — F-P1-29: the brief's
 * 5-state price machine.
 *
 * The brief requires exactly these five states for a product's
 * price: LIVE_VERIFIED / HISTORICAL_VERIFIED / UNVERIFIED / STALE /
 * SOURCE_UNAVAILABLE. The code already had the parts — a stored
 * 3-state enum (`PriceVerificationStatus`: unverified | verified |
 * stale), a 3-state freshness helper (`getFreshnessStatus`), and a
 * derived 5-state quality taxonomy (`DataQualityState`: verified |
 * partial | unverified | stale | missing) — but no single function
 * produced the brief's states, and SOURCE_UNAVAILABLE had no
 * per-product form at all.
 *
 * This module is THE one derived function. It is pure (no DB, no
 * network, no clock except the `now` parameter), and it is the
 * only place that maps a product's verification facts onto the
 * brief's states. It is NOT a third taxonomy: the mapping to and
 * from `DataQualityState` lives here too, so the two systems can
 * never drift apart silently.
 *
 * PRECEDENCE (first match wins — stated once, here):
 *   1. LIVE_VERIFIED — status 'verified' AND the check is fresh
 *      (age <= STALE_PRICE_DAYS). A real fetch checked this price
 *      within the freshness window.
 *   2. HISTORICAL_VERIFIED — status 'verified' AND the check is
 *      stale, or no check date is recorded at all. The price WAS
 *      verified once; the verification has expired (or its
 *      currency cannot be proven — F-P1-01: a dateless verified
 *      stamp is verified forever unless it lapses here).
 *   3. SOURCE_UNAVAILABLE — no price is recorded for this product
 *      at all, so there is nothing to verify and no live source
 *      could supply one. (A product WITH a recorded price is never
 *      SOURCE_UNAVAILABLE, even when every live source is
 *      currently unreachable — that is STALE or UNVERIFIED, with
 *      the reason saying the price cannot be re-checked right now.)
 *   4. STALE — a price IS recorded, it was never verified, and
 *      its last check is older than STALE_PRICE_DAYS. An old
 *      recorded price is not a current price.
 *   5. UNVERIFIED — a price IS recorded, it was never verified,
 *      and it is fresh or its age is unknown. Unknown age is NOT
 *      fresh (see lib/price-freshness.ts) — the reason says so —
 *      but "never checked" is the honest state, not "stale":
 *      nothing was ever verified, so nothing expired.
 *
 * A historical price must never render as a current live price:
 * only LIVE_VERIFIED may be shown with live/current wording.
 * Every other state carries a reason the surface must render
 * next to the label — a bare label without its rule is how the
 * old "verified" badges went wrong.
 */

import { STALE_PRICE_DAYS, getPriceAgeDays } from '@/lib/price-freshness';
import type { PriceVerificationStatus } from '@/services/price-verification';
import type { DataQualityState } from '@/services/product-quality-score';

/** The brief's five price states, in precedence order. */
export const PRICE_STATES = [
  'LIVE_VERIFIED',
  'HISTORICAL_VERIFIED',
  'UNVERIFIED',
  'STALE',
  'SOURCE_UNAVAILABLE',
] as const;

export type PriceState = (typeof PRICE_STATES)[number];

/** Display label for each state (one wording, everywhere). */
export const PRICE_STATE_LABELS: Record<PriceState, string> = {
  LIVE_VERIFIED: 'Live verified',
  HISTORICAL_VERIFIED: 'Historically verified',
  UNVERIFIED: 'Unverified',
  STALE: 'Stale',
  SOURCE_UNAVAILABLE: 'Source unavailable',
};

export interface PriceStateInput {
  /** Stored verification status (normalised by the caller, or raw). */
  priceVerificationStatus: PriceVerificationStatus | string | null;
  /** ISO timestamp of the last real verification check, or null. */
  priceVerifiedAt?: string | null;
  /**
   * Age in whole days of the last price check, or null (unknown).
   * When omitted, it is computed from `priceVerifiedAt` (or
   * `lastCheckedAt` when that is given instead).
   */
  priceAgeDays?: number | null;
  /**
   * ISO timestamp of the last price check of any kind (newest
   * price_history point, data_freshness). Used for the age only
   * when `priceAgeDays` is not supplied.
   */
  lastCheckedAt?: string | null;
  /** True when a price is recorded for this product at all. */
  hasRecordedPrice: boolean;
  /**
   * True when at least one live source can check this price right
   * now, false when none can, null/undefined when the caller does
   * not know (the reason then says so — unknown is never "yes").
   */
  hasLiveSource?: boolean | null;
  /** Clock for the age computation (default: now). Tests pin it. */
  now?: Date;
}

export interface PriceStateResult {
  state: PriceState;
  /** PRICE_STATE_LABELS[state] — the label to render. */
  label: string;
  /** Plain-language rule that produced this state (render it). */
  reason: string;
}

/**
 * The single derived function for the brief's 5 states. Pure.
 * `hasRecordedPrice` is the caller's fact (a merchant listing, a
 * price_history point, a recorded price) — never inferred from a
 * stamp, because a stamp without a price is not a price.
 */
export function derivePriceState(input: PriceStateInput): PriceStateResult {
  const status: PriceVerificationStatus =
    input.priceVerificationStatus === 'verified' ||
    input.priceVerificationStatus === 'stale'
      ? input.priceVerificationStatus
      : 'unverified';
  const now = input.now ?? new Date();
  const age =
    input.priceAgeDays !== undefined
      ? input.priceAgeDays
      : getPriceAgeDays(input.priceVerifiedAt ?? input.lastCheckedAt ?? null, now);
  const fresh = age !== null && age <= STALE_PRICE_DAYS;
  const sourceNote =
    input.hasLiveSource === false
      ? ' No live source can re-check this price right now.'
      : input.hasLiveSource === null || input.hasLiveSource === undefined
        ? ''
        : '';

  if (status === 'verified') {
    if (fresh) {
      return {
        state: 'LIVE_VERIFIED',
        label: PRICE_STATE_LABELS.LIVE_VERIFIED,
        reason: `The price was checked by a real fetch ${age} day${age === 1 ? '' : 's'} ago, within the ${STALE_PRICE_DAYS}-day freshness window.`,
      };
    }
    return {
      state: 'HISTORICAL_VERIFIED',
      label: PRICE_STATE_LABELS.HISTORICAL_VERIFIED,
      reason:
        age !== null
          ? `The price was verified once, but the check is ${age} days old — older than ${STALE_PRICE_DAYS} days, so the verification has expired.`
          : 'The price carries a verified stamp, but no check date is recorded, so the verification cannot be shown as current.',
    };
  }

  if (!input.hasRecordedPrice) {
    return {
      state: 'SOURCE_UNAVAILABLE',
      label: PRICE_STATE_LABELS.SOURCE_UNAVAILABLE,
      reason:
        input.hasLiveSource === false
          ? 'No price is recorded for this product and no live source can supply one.'
          : input.hasLiveSource === true
            ? 'No price is recorded for this product yet, even though a live source exists.'
            : 'No price is recorded for this product, so there is nothing to verify.',
    };
  }

  if (age !== null && age > STALE_PRICE_DAYS) {
    return {
      state: 'STALE',
      label: PRICE_STATE_LABELS.STALE,
      reason: `The recorded price was last checked ${age} days ago — older than ${STALE_PRICE_DAYS} days — and was never verified by a real fetch.${sourceNote}`,
    };
  }

  return {
    state: 'UNVERIFIED',
    label: PRICE_STATE_LABELS.UNVERIFIED,
    reason:
      age === null
        ? `The recorded price was never checked by a real fetch, and its age is unknown — it must not be read as fresh.${sourceNote}`
        : `The recorded price was never checked by a real fetch.${sourceNote}`,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation with DataQualityState (services/product-quality-score.ts).
//
// The two taxonomies describe the same record from different
// angles: DataQualityState is the record's verification label
// (including 'partial' — part of the record is independently
// checkable — which is NOT a price state), while PriceState is
// the price's state. The mapping is stated here, in both
// directions, so a surface can translate without inventing a
// third set of names.
//
// PriceState -> DataQualityState is LOSSY in one place: both
// HISTORICAL_VERIFIED (was verified, expired) and STALE (never
// verified, old) map to DataQualityState 'stale', because that
// taxonomy has one stale bucket for "verification expired or
// price too old". The reverse direction therefore needs the
// stored status + age to disambiguate — which is why
// priceStateFromDataQualityState takes them.
// ---------------------------------------------------------------------------

/** PriceState -> DataQualityState (lossy: see above). */
export const PRICE_STATE_TO_DATA_QUALITY_STATE: Record<PriceState, DataQualityState> = {
  LIVE_VERIFIED: 'verified',
  HISTORICAL_VERIFIED: 'stale',
  UNVERIFIED: 'unverified',
  STALE: 'stale',
  SOURCE_UNAVAILABLE: 'missing',
};

/**
 * DataQualityState -> PriceState. `partial` is a record-level
 * label (a GTIN or a recorded source makes part of the record
 * checkable); the PRICE itself was still never verified, so it
 * folds into UNVERIFIED (or STALE when the price is old) — the
 * partial-ness is not lost, it lives on the DataQualityState
 * side of the same record.
 */
export function priceStateFromDataQualityState(
  state: DataQualityState,
  input: {
    priceVerificationStatus: PriceVerificationStatus | string | null;
    priceAgeDays: number | null;
    hasRecordedPrice?: boolean;
    hasLiveSource?: boolean | null;
    now?: Date;
  }
): PriceStateResult {
  if (state === 'verified') {
    return derivePriceState({
      priceVerificationStatus: 'verified',
      priceAgeDays: input.priceAgeDays,
      hasRecordedPrice: true,
      hasLiveSource: input.hasLiveSource,
      now: input.now,
    });
  }
  if (state === 'missing') {
    return derivePriceState({
      priceVerificationStatus: input.priceVerificationStatus,
      priceAgeDays: input.priceAgeDays,
      hasRecordedPrice: false,
      hasLiveSource: input.hasLiveSource,
      now: input.now,
    });
  }
  if (state === 'stale') {
    // 'stale' covers two histories: was-verified-then-expired
    // (HISTORICAL_VERIFIED) and never-verified-but-old (STALE).
    // The stored status tells them apart.
    return derivePriceState({
      priceVerificationStatus: input.priceVerificationStatus,
      priceAgeDays: input.priceAgeDays,
      hasRecordedPrice: input.hasRecordedPrice ?? true,
      hasLiveSource: input.hasLiveSource,
      now: input.now,
    });
  }
  // 'partial' and 'unverified': the price itself was never
  // verified — the state is UNVERIFIED, or STALE when old.
  return derivePriceState({
    priceVerificationStatus: 'unverified',
    priceAgeDays: input.priceAgeDays,
    hasRecordedPrice: input.hasRecordedPrice ?? true,
    hasLiveSource: input.hasLiveSource,
    now: input.now,
  });
}
