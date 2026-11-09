/**
 * Recorded overrides engine (Option 19).
 *
 * Deterministic, no LLM, no fetch, no scraping. Pure math over values
 * recorded per product in the `products` table (migration 022).
 *
 * OVERRIDE-FIRST RULES (approved audit, 2026-11-09):
 * - These are RECORDED attributes. They OVERRIDE the existing derived
 *   engines — they never recreate them:
 *   * `annual_depreciation_rate` (fraction per year, 0–1) overrides
 *     the resale predictor's derived monthly decline when recorded.
 *     Otherwise the predictor keeps deriving from price_history.
 *   * `mandatory_accessories_cost` is a separate recorded line in the
 *     total-ownership total. The shopper's own accessories estimate
 *     stays user-entered and separate.
 * - Nothing is invented: a product with no recorded values gets NO
 *   override — the engines run exactly as before and the UI must show
 *   "Data accumulating" instead of a fabricated rate or cost.
 * - The recorded rate is a fraction per year (0.12 = 12%/year).
 *   Monthly decline = rate / 12, expressed as a percent.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

/** Recorded Option 19 values as stored on the products row (all nullable). */
export interface RecordedOverridesData {
  /** Recorded annual depreciation rate as a fraction (0–1), or null. */
  annualDepreciationRate: number | null;
  /** Recorded mandatory accessories cost in USD, or null. */
  mandatoryAccessoriesCost: number | null;
}

/** A recorded annual rate must be a fraction in [0, 1]; anything else is null. */
export function sanitizeAnnualRate(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

function sanitizeNonNegative(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Monthly decline percent implied by a recorded annual rate:
 * rate 0.12 (12%/year) → 1%/month. Returns null when no valid
 * recorded rate is supplied — the caller then falls back to the
 * derived decline.
 */
export function monthlyDeclinePctFromAnnualRate(
  annualRate: number | null | undefined
): number | null {
  const rate = sanitizeAnnualRate(annualRate);
  if (rate === null) return null;
  return Math.round((rate * 100) / 12 * 100) / 100;
}

/**
 * Fail-safe read of one product's Option 19 columns. Returns all
 * nulls when the columns/table do not exist yet (migration 022 not
 * run), when RLS blocks the read, or on any error — so callers can
 * run the derived engines unchanged instead of breaking the page.
 * Never throws.
 */
export async function getProductRecordedOverrides(
  supabase: AnySupabaseClient,
  productId: string
): Promise<RecordedOverridesData> {
  const empty: RecordedOverridesData = {
    annualDepreciationRate: null,
    mandatoryAccessoriesCost: null,
  };
  try {
    const { data, error } = await supabase
      .from('products')
      .select('annual_depreciation_rate, mandatory_accessories_cost')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductRecordedOverrides: query failed (022 may not be run)', {
          error: error.message,
        });
      }
      return empty;
    }
    const row = data as Record<string, unknown>;
    return {
      annualDepreciationRate: sanitizeAnnualRate(row.annual_depreciation_rate),
      mandatoryAccessoriesCost: sanitizeNonNegative(row.mandatory_accessories_cost),
    };
  } catch (err) {
    logger.warn('getProductRecordedOverrides: unexpected error', { error: String(err) });
    return empty;
  }
}
