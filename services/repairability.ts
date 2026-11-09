/**
 * Repairability & 10-Year Spare Parts Availability Index (Option 16).
 *
 * Deterministic, no LLM, no fetch, no scraping. The index is pure math
 * over values recorded per product in the `products` table (migration
 * 019). Nothing is invented: a product with no recorded repairability
 * data gets NO index — the UI must show "Not recorded yet".
 *
 * CORRECTED FORMULA (see audit 2026-11-09): the spec's
 * `repairability_score + spare_parts_years * 2` cannot work, because
 * repairability_score is a 0–10 scale — 7.0 + 10*2 = 27, so every
 * product would land under the <40 "Not Recommended" line. The index
 * is therefore:
 *
 *   index = min(100, round(repairability_score * 8 + spare_parts_years * 2))
 *
 * A 7.0 score with 10 years of parts scores 76. Spare-parts years are
 * optional: when unrecorded they contribute 0 and the result is
 * flagged as partial. A product is "Not Recommended for Long-Term Use"
 * when index < 40 OR local_repair_risk_level is 'High'.
 *
 * Spare-parts availability label is DERIVED from years, never stored
 * as a separate claim: >= 7 years High, 4–6 Medium, < 4 Low.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

export type LocalRepairRiskLevel = 'Low' | 'Medium' | 'High';

/** Repairability values as stored on the products row (all nullable). */
export interface RepairabilityData {
  /** 0–10 score, or null when not recorded. */
  repairabilityScore: number | null;
  /** Years spare parts are available, or null when not recorded. */
  sparePartsYears: number | null;
  /** Local repair risk, or null when not recorded. */
  localRepairRiskLevel: LocalRepairRiskLevel | null;
}

export type RepairabilityVerdict =
  | 'unknown'
  | 'not-recommended'
  | 'good'
  | 'excellent';

export type SparePartsAvailability =
  | 'High'
  | 'Medium'
  | 'Low'
  | 'Not recorded';

export interface RepairabilityIndex {
  /** 0–100, or null when there is no recorded score to index. */
  index: number | null;
  verdict: RepairabilityVerdict;
  availabilityLabel: SparePartsAvailability;
  hasScore: boolean;
  hasPartsYears: boolean;
  hasRisk: boolean;
}

export const REPAIRABILITY_NOT_RECOMMENDED_BELOW = 40;
export const REPAIRABILITY_EXCELLENT_FROM = 70;

function sanitizeScore(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return n;
}

function sanitizeYears(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sanitizeRisk(value: unknown): LocalRepairRiskLevel | null {
  return value === 'Low' || value === 'Medium' || value === 'High' ? value : null;
}

/**
 * Availability label derived from recorded spare-parts years.
 * >= 7 years High, 4–6 Medium, below 4 Low, unrecorded → 'Not recorded'.
 */
export function availabilityLabelForYears(
  years: number | null | undefined
): SparePartsAvailability {
  if (years === null || years === undefined || !Number.isFinite(years)) return 'Not recorded';
  if (years >= 7) return 'High';
  if (years >= 4) return 'Medium';
  return 'Low';
}

/**
 * Repairability index from recorded data. Returns index null + verdict
 * 'unknown' when no score is recorded — never a number from nothing.
 * Unrecorded spare-parts years contribute 0 (flagged via hasPartsYears).
 */
export function computeRepairabilityIndex(
  input: RepairabilityData
): RepairabilityIndex {
  const score = sanitizeScore(input.repairabilityScore);
  const years = sanitizeYears(input.sparePartsYears);
  const risk = sanitizeRisk(input.localRepairRiskLevel);

  const hasScore = score !== null;
  const hasPartsYears = years !== null;
  const hasRisk = risk !== null;

  if (!hasScore || score === null) {
    return {
      index: null,
      verdict: 'unknown',
      availabilityLabel: availabilityLabelForYears(years),
      hasScore,
      hasPartsYears,
      hasRisk,
    };
  }

  const index = Math.min(100, Math.round(score * 8 + (years ?? 0) * 2));

  let verdict: RepairabilityVerdict = 'good';
  if (index < REPAIRABILITY_NOT_RECOMMENDED_BELOW || risk === 'High') {
    verdict = 'not-recommended';
  } else if (index >= REPAIRABILITY_EXCELLENT_FROM) {
    verdict = 'excellent';
  }

  return {
    index,
    verdict,
    availabilityLabel: availabilityLabelForYears(years),
    hasScore,
    hasPartsYears,
    hasRisk,
  };
}

/**
 * Fail-safe read of one product's repairability columns. Returns all
 * nulls when the columns/table do not exist yet (migration 019 not run),
 * when RLS blocks the read, or on any error — so callers can render an
 * honest empty state instead of breaking the page. Never throws.
 */
export async function getProductRepairability(
  supabase: AnySupabaseClient,
  productId: string
): Promise<RepairabilityData> {
  const empty: RepairabilityData = {
    repairabilityScore: null,
    sparePartsYears: null,
    localRepairRiskLevel: null,
  };
  try {
    const { data, error } = await supabase
      .from('products')
      .select('repairability_score, spare_parts_years, local_repair_risk_level')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductRepairability: query failed (019 may not be run)', {
          error: error.message,
        });
      }
      return empty;
    }
    const row = data as Record<string, unknown>;
    return {
      repairabilityScore: sanitizeScore(row.repairability_score),
      sparePartsYears: sanitizeYears(row.spare_parts_years),
      localRepairRiskLevel: sanitizeRisk(row.local_repair_risk_level),
    };
  } catch (err) {
    logger.warn('getProductRepairability: unexpected error', { error: String(err) });
    return empty;
  }
}
