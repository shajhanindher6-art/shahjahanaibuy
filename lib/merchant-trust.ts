/**
 * Store trust scores (Section 3 #14).
 *
 * Deterministic grades computed ONLY from recorded merchant policy
 * data (migration 028 columns on `merchants`): return window,
 * warranty length, and a reputation score. Every one of those values
 * is NULL until the owner verifies the real policy facts — NO policy
 * value is ever invented, defaulted, or guessed.
 *
 * Grade rule, stated plainly so a grade is never a black box:
 *   * Any of the three inputs missing → NO grade at all:
 *     "Not enough data". A partial score is never shown as a grade.
 *   * All three recorded → score 0–100, grade A (≥85), B (≥70),
 *     C (≥50), D (<50).
 *   * Score parts: return window 0–40, warranty 0–30, reputation
 *     0–30 (reputation 0–5 scaled to 30).
 *
 * Fail-safe: `getMerchantPolicy` returns an all-null policy when the
 * columns (or the merchant) are missing, so callers render
 * "Not enough data" instead of erroring.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Recorded policy facts for one merchant. All nullable by design. */
export interface MerchantPolicy {
  merchantId: string;
  returnWindowDays: number | null;
  warrantyMonths: number | null;
  reputationScore: number | null;
  returnPolicyUrl: string | null;
  warrantyPolicyUrl: string | null;
  policyVerifiedAt: string | null;
}

export type TrustGrade = 'A' | 'B' | 'C' | 'D';

export interface TrustGradeResult {
  /** Null when any input is missing — no grade is shown then. */
  grade: TrustGrade | null;
  /** Null alongside a null grade. */
  score: number | null;
  /** Which recorded inputs are still missing (drives the UI copy). */
  missing: Array<'returnWindowDays' | 'warrantyMonths' | 'reputationScore'>;
  /** Point breakdown, present only when a grade was computed. */
  breakdown: {
    returnWindowPoints: number;
    warrantyPoints: number;
    reputationPoints: number;
  } | null;
  /** Plain-language reasons for the grade (or for the missing data). */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Pure scoring
// ---------------------------------------------------------------------------

export function returnWindowPoints(days: number): number {
  if (days >= 30) return 40;
  if (days >= 14) return 30;
  if (days >= 7) return 15;
  if (days >= 1) return 5;
  return 0;
}

export function warrantyPoints(months: number): number {
  if (months >= 24) return 30;
  if (months >= 12) return 20;
  if (months >= 6) return 10;
  if (months >= 1) return 5;
  return 0;
}

export function reputationPoints(score: number): number {
  const clamped = Math.min(5, Math.max(0, score));
  return Math.round((clamped / 5) * 30);
}

export function gradeForScore(score: number): TrustGrade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

/**
 * Compute the trust grade from recorded policy data only.
 * Missing any input → grade null, score null, "Not enough data".
 */
export function computeTrustGrade(
  policy: Pick<MerchantPolicy, 'returnWindowDays' | 'warrantyMonths' | 'reputationScore'>
): TrustGradeResult {
  const missing: TrustGradeResult['missing'] = [];
  if (policy.returnWindowDays === null || policy.returnWindowDays === undefined) {
    missing.push('returnWindowDays');
  }
  if (policy.warrantyMonths === null || policy.warrantyMonths === undefined) {
    missing.push('warrantyMonths');
  }
  if (policy.reputationScore === null || policy.reputationScore === undefined) {
    missing.push('reputationScore');
  }

  if (missing.length > 0) {
    const labels: Record<string, string> = {
      returnWindowDays: 'return window',
      warrantyMonths: 'warranty length',
      reputationScore: 'reputation score',
    };
    return {
      grade: null,
      score: null,
      missing,
      breakdown: null,
      reasons: [
        `Not enough data — still needed: ${missing.map((m) => labels[m]).join(', ')}. ` +
          'No policy values have been recorded for this store yet, so no trust grade is shown.',
      ],
    };
  }

  const breakdown = {
    returnWindowPoints: returnWindowPoints(policy.returnWindowDays as number),
    warrantyPoints: warrantyPoints(policy.warrantyMonths as number),
    reputationPoints: reputationPoints(policy.reputationScore as number),
  };
  const score =
    breakdown.returnWindowPoints + breakdown.warrantyPoints + breakdown.reputationPoints;
  const grade = gradeForScore(score);

  return {
    grade,
    score,
    missing: [],
    breakdown,
    reasons: [
      `Return window ${policy.returnWindowDays} days (${breakdown.returnWindowPoints}/40).`,
      `Warranty ${policy.warrantyMonths} months (${breakdown.warrantyPoints}/30).`,
      `Reputation ${policy.reputationScore}/5 (${breakdown.reputationPoints}/30).`,
      'Grade computed only from recorded policy data — no values were assumed.',
    ],
  };
}

/** The label the UI shows when no grade can be computed. */
export const TRUST_GRADE_INSUFFICIENT_LABEL = 'Not enough data';

// ---------------------------------------------------------------------------
// Fail-safe read (separate query — never added to the main merchant select)
// ---------------------------------------------------------------------------

const POLICY_COLUMNS =
  'id, return_window_days, warranty_months, reputation_score, return_policy_url, warranty_policy_url, policy_verified_at';

/**
 * Read one merchant's recorded policy facts. Returns an all-null
 * policy when the merchant is missing, the columns are missing
 * (migration 028 not run yet), or the query fails — the caller then
 * renders "Not enough data".
 */
export async function getMerchantPolicy(
  supabase: AnySupabaseClient,
  merchantId: string
): Promise<MerchantPolicy> {
  const empty: MerchantPolicy = {
    merchantId,
    returnWindowDays: null,
    warrantyMonths: null,
    reputationScore: null,
    returnPolicyUrl: null,
    warrantyPolicyUrl: null,
    policyVerifiedAt: null,
  };

  try {
    const { data, error } = await supabase
      .from('merchants')
      .select(POLICY_COLUMNS)
      .eq('id', merchantId)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getMerchantPolicy: query failed', { error: error.message });
      return empty;
    }

    const row = data as {
      id: string;
      return_window_days: number | null;
      warranty_months: number | null;
      reputation_score: number | string | null;
      return_policy_url: string | null;
      warranty_policy_url: string | null;
      policy_verified_at: string | null;
    };
    return {
      merchantId: row.id,
      returnWindowDays: row.return_window_days,
      warrantyMonths: row.warranty_months,
      reputationScore:
        row.reputation_score === null ? null : Number(row.reputation_score),
      returnPolicyUrl: row.return_policy_url,
      warrantyPolicyUrl: row.warranty_policy_url,
      policyVerifiedAt: row.policy_verified_at,
    };
  } catch (err) {
    logger.error('getMerchantPolicy: unexpected error', { error: String(err) });
    return empty;
  }
}
