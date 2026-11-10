/**
 * Verified Merchant program (Section 5 #15).
 *
 * Public standards, public badge, public removal policy. A merchant
 * earns the "Verified Merchant" badge ONLY when recorded data meets
 * EVERY standard below — no merchant has the badge today, because no
 * merchant has recorded data meeting all of them. That is the honest
 * empty state, not a bug: the badge is earned by evidence, never
 * granted by default.
 *
 * Standards (all checked against recorded data only):
 *   1. Price accuracy ≥ 95% across ≥ 10 recorded checkout-audit
 *      samples (lib/price-accuracy.ts).
 *   2. Return window ≥ 14 days (recorded policy).
 *   3. Warranty ≥ 12 months (recorded policy).
 *   4. Store trust grade A or B (lib/merchant-trust.ts).
 *   5. A named contact / policy page on record (return or warranty
 *      policy URL).
 *
 * Re-checks: verification lasts 90 days, then the merchant must be
 * re-checked against the same standards. Removal: the badge is
 * removed as soon as any standard lapses (accuracy drops below 95%,
 * a shorter return window is recorded, or the 90-day window expires
 * without a re-check). Removal is public — the merchant simply stops
 * appearing in the verified list.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import type { TrustGrade } from '@/lib/merchant-trust';

// ---------------------------------------------------------------------------
// Public standards text (rendered verbatim in the UI / API)
// ---------------------------------------------------------------------------

export const VERIFIED_MERCHANT_RECHECK_DAYS = 90;
export const VERIFIED_MERCHANT_MIN_ACCURACY = 95;
export const VERIFIED_MERCHANT_MIN_AUDIT_SAMPLES = 10;
export const VERIFIED_MERCHANT_MIN_RETURN_DAYS = 14;
export const VERIFIED_MERCHANT_MIN_WARRANTY_MONTHS = 12;

export const VERIFIED_MERCHANT_MEANING =
  'A "Verified Merchant" has passed SmartBuy’s public checks: at least 95% of its ' +
  'recorded checkout prices matched its listed prices (10+ recorded audits), a return ' +
  'window of 14+ days, a warranty of 12+ months, a store trust grade of A or B, and a ' +
  'published returns/warranty policy. Verification is re-checked every 90 days and ' +
  'removed if any standard lapses. Verification is about the store’s recorded policies ' +
  'and price accuracy — it is not a guarantee of any single order, delivery time, or price.';

export const VERIFIED_MERCHANT_REMOVAL_POLICY =
  'The badge is removed when any standard lapses: price accuracy below 95%, a shorter ' +
  'return window or warranty recorded, a trust grade below B, or no re-check within ' +
  '90 days of the last verification. Removed merchants are not announced as "untrusted" — ' +
  'they simply lose the badge until they meet the standards again.';

export const VERIFIED_MERCHANT_STANDARDS: Array<{ key: string; label: string; detail: string }> = [
  {
    key: 'price_accuracy',
    label: 'Price accuracy ≥ 95%',
    detail: `At least ${VERIFIED_MERCHANT_MIN_ACCURACY}% of recorded checkout prices matched the listed price, across ${VERIFIED_MERCHANT_MIN_AUDIT_SAMPLES}+ recorded audit samples.`,
  },
  {
    key: 'returns',
    label: `Return window ≥ ${VERIFIED_MERCHANT_MIN_RETURN_DAYS} days`,
    detail: 'A recorded return window of at least 14 days.',
  },
  {
    key: 'warranty',
    label: `Warranty ≥ ${VERIFIED_MERCHANT_MIN_WARRANTY_MONTHS} months`,
    detail: 'A recorded warranty of at least 12 months.',
  },
  {
    key: 'trust_grade',
    label: 'Store trust grade A or B',
    detail: 'Computed only from recorded return, warranty, and reputation data.',
  },
  {
    key: 'policy_page',
    label: 'Published policy page',
    detail: 'A recorded return or warranty policy URL.',
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifiedMerchant {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
  verifiedAt: string | null;
  verifiedUntil: string | null;
}

/** Everything the eligibility check needs — all recorded, none assumed. */
export interface MerchantVerificationInput {
  accuracyScore: number | null;
  auditSampleCount: number;
  returnWindowDays: number | null;
  warrantyMonths: number | null;
  trustGrade: TrustGrade | null;
  hasPolicyUrl: boolean;
}

export interface VerificationEligibility {
  eligible: boolean;
  /** Standards not yet met (empty when eligible). */
  unmet: string[];
}

// ---------------------------------------------------------------------------
// Pure eligibility check
// ---------------------------------------------------------------------------

/**
 * Does recorded data meet EVERY public standard? Missing data counts
 * as unmet — a merchant is never verified on partial evidence.
 */
export function meetsVerifiedMerchantStandards(
  input: MerchantVerificationInput
): VerificationEligibility {
  const unmet: string[] = [];

  if (
    input.accuracyScore === null ||
    input.auditSampleCount < VERIFIED_MERCHANT_MIN_AUDIT_SAMPLES ||
    input.accuracyScore < VERIFIED_MERCHANT_MIN_ACCURACY
  ) {
    unmet.push(
      input.accuracyScore === null
        ? 'Price accuracy: no checkout audits recorded yet.'
        : `Price accuracy: ${input.accuracyScore}% across ${input.auditSampleCount} samples — needs ≥ ${VERIFIED_MERCHANT_MIN_ACCURACY}% across ${VERIFIED_MERCHANT_MIN_AUDIT_SAMPLES}+ samples.`
    );
  }
  if (input.returnWindowDays === null || input.returnWindowDays < VERIFIED_MERCHANT_MIN_RETURN_DAYS) {
    unmet.push(
      input.returnWindowDays === null
        ? 'Return window: not recorded.'
        : `Return window: ${input.returnWindowDays} days — needs ≥ ${VERIFIED_MERCHANT_MIN_RETURN_DAYS} days.`
    );
  }
  if (input.warrantyMonths === null || input.warrantyMonths < VERIFIED_MERCHANT_MIN_WARRANTY_MONTHS) {
    unmet.push(
      input.warrantyMonths === null
        ? 'Warranty: not recorded.'
        : `Warranty: ${input.warrantyMonths} months — needs ≥ ${VERIFIED_MERCHANT_MIN_WARRANTY_MONTHS} months.`
    );
  }
  if (input.trustGrade !== 'A' && input.trustGrade !== 'B') {
    unmet.push(
      input.trustGrade === null
        ? 'Store trust grade: not enough recorded data.'
        : `Store trust grade: ${input.trustGrade} — needs A or B.`
    );
  }
  if (!input.hasPolicyUrl) {
    unmet.push('Published policy page: no return or warranty policy URL recorded.');
  }

  return { eligible: unmet.length === 0, unmet };
}

/** Is a verification still inside its 90-day window? */
export function isVerificationCurrent(verifiedUntil: string | null, now = new Date()): boolean {
  if (!verifiedUntil) return false;
  return new Date(verifiedUntil).getTime() > now.getTime();
}

// ---------------------------------------------------------------------------
// Fail-safe read
// ---------------------------------------------------------------------------

/**
 * Merchants currently carrying the badge (and still inside their
 * 90-day window — an expired verification is not shown as verified).
 * Returns [] when the columns are missing (migration 028 not run
 * yet) or the query fails. Today this is []: no merchant has recorded
 * data meeting all standards.
 */
export async function getVerifiedMerchants(
  supabase: AnySupabaseClient
): Promise<VerifiedMerchant[]> {
  try {
    const { data, error } = await supabase
      .from('merchants')
      .select('id, name, slug, website_url, merchant_verified_at, merchant_verified_until')
      .eq('is_verified_merchant', true)
      .eq('active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (error || !data) {
      if (error) logger.warn('getVerifiedMerchants: query failed', { error: error.message });
      return [];
    }

    const now = new Date();
    return (data as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        slug: String(row.slug),
        websiteUrl: row.website_url === null ? null : String(row.website_url),
        verifiedAt: row.merchant_verified_at === null ? null : String(row.merchant_verified_at),
        verifiedUntil:
          row.merchant_verified_until === null ? null : String(row.merchant_verified_until),
      }))
      .filter((m) => isVerificationCurrent(m.verifiedUntil, now));
  } catch (err) {
    logger.error('getVerifiedMerchants: unexpected error', { error: String(err) });
    return [];
  }
}
