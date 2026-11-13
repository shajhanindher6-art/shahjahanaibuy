/**
 * Merchant reliability scoring (Section 19, Phase 5, §12 #50).
 *
 * The comparison used to show no merchant score anywhere. This
 * module scores a merchant ONLY from real signals that exist today
 * — and says "not enough data to score this merchant" when they
 * don't. Nothing is invented: a merchant with no evidence beyond a
 * bare directory listing gets no score at all, never a guessed one.
 *
 * SIGNALS THAT FEED THE SCORE (weights in scoreMerchantReliability):
 *   1. in_directory (+10) — an active row in the stores directory
 *      (`merchants`, migration 005). Every scored merchant has this.
 *   2. website (+10) — a `website_url` is recorded for the merchant.
 *   3. verified badge (+30) — `merchants.is_verified_merchant`
 *      (migration 028). True only when the merchant earned the
 *      Verified Merchant badge; false adds nothing (absence of the
 *      badge is not evidence of unreliability); null (column
 *      unreadable — 028 not applied) is treated as unknown.
 *   4. trust grade (+25 A / +20 B / +10 C / +0 D) — the recorded
 *      policy trust grade from lib/merchant-trust.ts (return window
 *      + warranty + reputation, all recorded, never defaulted).
 *      Null when any policy input is missing — a partial grade is
 *      never shown as a score.
 *   5. catalog coverage (+10 for 1–4 live listings, +15 for 5+) —
 *      live `merchant_products` rows for this merchant. A merchant
 *      that actually lists products is more established than one
 *      that lists none.
 *   6. policy record (+10) — any of return window / warranty /
 *      reputation is recorded (migration 028 columns).
 *
 * NOT ENOUGH DATA: when the only evidence is a directory listing
 * plus fewer than 5 listings — no website, no verified badge, no
 * trust grade, no policy record — the score is null and the
 * explanation names exactly what is missing. The owner unblocks
 * real scores by recording merchant policies (migration 028 columns:
 * return_window_days, warranty_months, reputation_score) and by
 * running the Verified Merchant program (lib/verified-merchants.ts).
 *
 * Pure scorer + fail-safe DB reader. The DB reader never throws:
 * a missing merchant, missing 028 columns, or a failed query all
 * degrade to the not-enough-data state.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  computeTrustGrade,
  getMerchantPolicy,
  type MerchantPolicy,
  type TrustGrade,
} from '@/lib/merchant-trust';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MerchantReliabilityLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface MerchantReliabilitySignal {
  key: string;
  label: string;
  /** True when this signal contributed to the score. */
  present: boolean;
  /** Plain-language detail (shown in the explanation). */
  detail: string;
}

export interface MerchantReliability {
  merchantId: string;
  merchantName: string;
  /** 0–100 when enough signals exist; null = not enough data. */
  score: number | null;
  level: MerchantReliabilityLevel;
  /** Verified Merchant badge (028). Null when unknown/unreadable. */
  verified: boolean | null;
  /** Recorded policy trust grade. Null when policy data is incomplete. */
  trustGrade: TrustGrade | null;
  trustScore: number | null;
  signals: MerchantReliabilitySignal[];
  /** Plain-language explanation: the score + which signals fed it, or what is missing. */
  explanation: string;
  /** True when the score is null — the UI renders the honest empty state. */
  notEnoughData: boolean;
}

/** Everything the pure scorer needs — all recorded, none assumed. */
export interface MerchantReliabilityInput {
  merchantId: string;
  merchantName: string;
  /** Active row in the stores directory. */
  inDirectory: boolean;
  /** A website_url is recorded. */
  hasWebsite: boolean;
  /** is_verified_merchant; null = unknown (028 column unreadable). */
  verified: boolean | null;
  trustGrade: TrustGrade | null;
  trustScore: number | null;
  /** Live merchant_products rows for this merchant. */
  listingCount: number;
  /** Any of return window / warranty / reputation recorded. */
  hasPolicyRecord: boolean;
}

// ---------------------------------------------------------------------------
// Pure scoring
// ---------------------------------------------------------------------------

const TRUST_GRADE_POINTS: Record<TrustGrade, number> = { A: 25, B: 20, C: 10, D: 0 };

/**
 * Score a merchant from recorded signals only. Returns a null score
 * (notEnoughData) when the evidence is a bare directory listing —
 * no website, no verified badge, no trust grade, no policy record,
 * and fewer than 5 listings. The explanation always names the
 * signals that fed the score (or the ones that are missing).
 */
export function scoreMerchantReliability(input: MerchantReliabilityInput): MerchantReliability {
  const signals: MerchantReliabilitySignal[] = [];
  let score = 0;

  signals.push({
    key: 'in_directory',
    label: 'Listed in the stores directory',
    present: input.inDirectory,
    detail: input.inDirectory
      ? 'an active merchant row in the stores directory'
      : 'no active merchant row in the stores directory',
  });
  if (input.inDirectory) score += 10;

  signals.push({
    key: 'website',
    label: 'Website on file',
    present: input.hasWebsite,
    detail: input.hasWebsite ? 'a website URL is recorded' : 'no website URL recorded',
  });
  if (input.hasWebsite) score += 10;

  signals.push({
    key: 'verified_badge',
    label: 'Verified Merchant badge',
    present: input.verified === true,
    detail:
      input.verified === true
        ? 'earned the Verified Merchant badge (95%+ price accuracy, 14+ day returns, 12+ month warranty, trust grade A/B)'
        : input.verified === false
          ? 'no Verified Merchant badge on record'
          : 'verified status unknown (verification data not recorded)',
  });
  if (input.verified === true) score += 30;

  const gradePoints = input.trustGrade ? TRUST_GRADE_POINTS[input.trustGrade] : 0;
  signals.push({
    key: 'trust_grade',
    label: 'Policy trust grade',
    present: input.trustGrade !== null,
    detail:
      input.trustGrade !== null
        ? `trust grade ${input.trustGrade}${input.trustScore !== null ? ` (${input.trustScore}/100)` : ''} from recorded return, warranty and reputation data`
        : 'no trust grade — return window, warranty or reputation is not recorded',
  });
  score += gradePoints;

  const coveragePoints = input.listingCount >= 5 ? 15 : input.listingCount >= 1 ? 10 : 0;
  signals.push({
    key: 'catalog_coverage',
    label: 'Product listings',
    present: input.listingCount >= 1,
    detail:
      input.listingCount === 0
        ? 'no live product listings'
        : `${input.listingCount} live product listing${input.listingCount === 1 ? '' : 's'}`,
  });
  score += coveragePoints;

  signals.push({
    key: 'policy_record',
    label: 'Policy on file',
    present: input.hasPolicyRecord,
    detail: input.hasPolicyRecord
      ? 'a return window, warranty or reputation score is recorded'
      : 'no return, warranty or reputation policy recorded',
  });
  if (input.hasPolicyRecord) score += 10;

  // Not enough data: the only evidence is a bare directory listing
  // (plus fewer than 5 listings). A score built on that alone would
  // be a guess dressed as a number — so there is no score.
  const hasInformativeSignal =
    input.hasWebsite ||
    input.verified === true ||
    input.trustGrade !== null ||
    input.hasPolicyRecord ||
    input.listingCount >= 5;
  if (!hasInformativeSignal) {
    return {
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      score: null,
      level: 'unknown',
      verified: input.verified,
      trustGrade: input.trustGrade,
      trustScore: input.trustScore,
      signals,
      explanation:
        `Not enough data to score ${input.merchantName} — only a stores-directory listing` +
        (input.listingCount > 0
          ? ` and ${input.listingCount} product listing${input.listingCount === 1 ? '' : 's'} are recorded`
          : ' is recorded') +
        '; no website, verified status, policy, or trust grade is on file.',
      notEnoughData: true,
    };
  }

  const level: MerchantReliabilityLevel =
    score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const contributing = signals.filter((s) => s.present).map((s) => s.label);
  return {
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    score,
    level,
    verified: input.verified,
    trustGrade: input.trustGrade,
    trustScore: input.trustScore,
    signals,
    explanation:
      `Reliability ${score}/100 (${level}) for ${input.merchantName} — based on: ` +
      `${contributing.join('; ')}. ` +
      (input.verified === true
        ? 'Verified Merchant badge held.'
        : 'No Verified Merchant badge on record.'),
    notEnoughData: false,
  };
}

/** "24-month warranty (recorded merchant policy)" — null when none recorded. */
export function formatWarranty(warrantyMonths: number | null | undefined): string | null {
  if (warrantyMonths === null || warrantyMonths === undefined) return null;
  if (!Number.isFinite(warrantyMonths) || warrantyMonths < 0) return null;
  if (warrantyMonths === 0) return 'No warranty (recorded merchant policy)';
  return `${warrantyMonths}-month warranty (recorded merchant policy)`;
}

// ---------------------------------------------------------------------------
// Fail-safe DB reader
// ---------------------------------------------------------------------------

export interface MerchantDirectoryRow {
  id: string;
  name: string;
  websiteUrl: string | null;
  active: boolean;
}

/**
 * Score one merchant from the live database. Never throws: a
 * missing merchant, missing 028 columns, or a failed query all
 * degrade to the not-enough-data state (score null).
 */
export async function getMerchantReliability(
  supabase: AnySupabaseClient,
  merchant: MerchantDirectoryRow,
  policy?: MerchantPolicy
): Promise<MerchantReliability> {
  try {
    const merchantPolicy = policy ?? (await getMerchantPolicy(supabase, merchant.id));
    const grade = computeTrustGrade(merchantPolicy);

    // is_verified_merchant lives behind migration 028 — a separate
    // fail-safe read so a missing column degrades to "unknown"
    // instead of failing the whole reliability lookup.
    let verified: boolean | null = null;
    try {
      const { data, error } = await supabase
        .from('merchants')
        .select('is_verified_merchant')
        .eq('id', merchant.id)
        .maybeSingle();
      if (!error && data) {
        const flag = (data as Record<string, unknown>).is_verified_merchant;
        verified = typeof flag === 'boolean' ? flag : null;
      }
    } catch {
      verified = null;
    }

    // Live listing count (capped read — the catalog is small).
    let listingCount = 0;
    try {
      const { data, error } = await supabase
        .from('merchant_products')
        .select('id')
        .eq('merchant_id', merchant.id)
        .is('deleted_at', null)
        .limit(500);
      if (!error && data) listingCount = (data as unknown[]).length;
    } catch {
      listingCount = 0;
    }

    return scoreMerchantReliability({
      merchantId: merchant.id,
      merchantName: merchant.name,
      inDirectory: merchant.active,
      hasWebsite: merchant.websiteUrl !== null && merchant.websiteUrl !== '',
      verified,
      trustGrade: grade.grade,
      trustScore: grade.score,
      listingCount,
      hasPolicyRecord:
        merchantPolicy.returnWindowDays !== null ||
        merchantPolicy.warrantyMonths !== null ||
        merchantPolicy.reputationScore !== null,
    });
  } catch (err) {
    logger.error('getMerchantReliability: unexpected error', { error: String(err) });
    return scoreMerchantReliability({
      merchantId: merchant.id,
      merchantName: merchant.name,
      inDirectory: merchant.active,
      hasWebsite: false,
      verified: null,
      trustGrade: null,
      trustScore: null,
      listingCount: 0,
      hasPolicyRecord: false,
    });
  }
}
