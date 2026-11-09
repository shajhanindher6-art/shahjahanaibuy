/**
 * Global readiness engine (Option 20).
 *
 * Deterministic, no LLM, no fetch, no scraping. Pure logic over values
 * recorded per product in the `products` table (migration 023).
 *
 * This is the CLEAN delta only — it does NOT recreate anything already
 * live: FX rates (services/fx-rates.ts, live daily feed), landed-cost
 * (LandedCostCalculator + 60-region arbitrage), Buy vs Wait
 * (services/buy-wait-prediction.ts) and the decision matrices
 * (Option 14 spec matrix, Option 16 Decision Suite) are all reused
 * as-is. This engine adds only the three recorded readiness signals.
 *
 * NOTHING IS INVENTED:
 * - All three columns default to NULL. A product with no recorded
 *   values gets NO availability claim, NO warranty type and NO
 *   release signal — the UI must show "Not recorded".
 * - `regional_availability` is a recorded map, e.g. {"US": true,
 *   "PK": false}. It is never defaulted to a hardcoded region set,
 *   and it never claims availability the owner has not recorded.
 * - `global_warranty_type` is a recorded label. Warranty is
 *   manufacturer-dependent (see services/return-policies.ts) and is
 *   never assumed — a missing value stays "Not recorded".
 * - `next_gen_release_months` is a RECORDED release schedule (months
 *   until the next generation, as recorded by the owner). It is not a
 *   prediction: nothing here forecasts a release date. The signal it
 *   produces is a nudge ("consider waiting") at <= 3 months, labeled
 *   as coming from the recorded schedule.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

/** Recorded Option 20 values as stored on the products row (all nullable). */
export interface GlobalReadinessData {
  /** Recorded per-region availability map, or null when not recorded. */
  regionalAvailability: Record<string, boolean> | null;
  /** Recorded months until the next generation, or null. */
  nextGenReleaseMonths: number | null;
  /** Recorded warranty scope label, or null when not recorded. */
  globalWarrantyType: string | null;
}

/** Months at or below which the next-gen signal suggests waiting. */
export const NEXT_GEN_WAIT_THRESHOLD_MONTHS = 3;
/** Warranty column width (VARCHAR(50)) — recorded labels longer than this are trimmed. */
export const WARRANTY_TYPE_MAX_LENGTH = 50;

/** Canonical warranty labels. A recorded value matching one (case-insensitive) is shown canonically; any other non-empty recorded value is shown verbatim as recorded. */
export const KNOWN_WARRANTY_TYPES = [
  'Local Manufacturer',
  'International',
  'Regional',
  'Seller / Retailer',
] as const;

/**
 * Sanitize a recorded regional-availability map. Accepts a plain
 * object (or a JSON string of one) whose keys are region codes and
 * whose values are booleans. Keys are upper-cased and trimmed;
 * entries with non-boolean values are dropped. Returns null when
 * nothing valid remains — never a fabricated map.
 */
export function sanitizeRegionalAvailability(
  value: unknown
): Record<string, boolean> | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const out: Record<string, boolean> = {};
  for (const [rawKey, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof rawValue !== 'boolean') continue;
    const key = rawKey.trim().toUpperCase();
    if (key === '') continue;
    out[key] = rawValue;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** A recorded next-gen schedule must be a non-negative integer number of months. */
export function sanitizeNextGenMonths(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** A recorded warranty label: trimmed text within the column width, or null. */
export function sanitizeWarrantyType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, WARRANTY_TYPE_MAX_LENGTH);
}

/** Canonical label for a recorded warranty type, or the recorded value verbatim. */
export function warrantyLabel(globalWarrantyType: string | null): string {
  const clean = sanitizeWarrantyType(globalWarrantyType);
  if (clean === null) return 'Not recorded';
  const match = KNOWN_WARRANTY_TYPES.find(
    (known) => known.toLowerCase() === clean.toLowerCase()
  );
  return match ?? clean;
}

export type AvailabilityStatus = 'not_recorded' | 'available' | 'none_available';

export interface AvailabilitySummary {
  status: AvailabilityStatus;
  /** Region codes recorded as available. */
  availableRegions: string[];
  /** Region codes recorded as unavailable. */
  unavailableRegions: string[];
  /** One-line summary, e.g. "Available in 2 recorded regions". */
  label: string;
}

/**
 * One-line summary of a recorded availability map. Never claims a
 * region the owner has not recorded.
 */
export function availabilitySummary(
  regionalAvailability: Record<string, boolean> | null
): AvailabilitySummary {
  const map = sanitizeRegionalAvailability(regionalAvailability);
  if (map === null) {
    return {
      status: 'not_recorded',
      availableRegions: [],
      unavailableRegions: [],
      label: 'Availability not recorded',
    };
  }
  const availableRegions = Object.keys(map).filter((code) => map[code]);
  const unavailableRegions = Object.keys(map).filter((code) => !map[code]);
  if (availableRegions.length === 0) {
    return {
      status: 'none_available',
      availableRegions,
      unavailableRegions,
      label: 'Not available in any recorded region',
    };
  }
  const noun = availableRegions.length === 1 ? 'region' : 'regions';
  return {
    status: 'available',
    availableRegions,
    unavailableRegions,
    label: `Available in ${availableRegions.length} recorded ${noun}`,
  };
}

export type NextGenStatus = 'unknown' | 'soon' | 'later';

export interface NextGenSignal {
  status: NextGenStatus;
  /** Months until the next generation, or null when no schedule is recorded. */
  months: number | null;
  /** One-line signal, labeled as coming from the recorded schedule. */
  label: string;
}

/**
 * Next-generation signal from a RECORDED release schedule.
 * <= 3 months → "consider waiting" nudge; anything further out is
 * shown without a nudge. No schedule recorded → unknown, never a
 * forecast. The label always says "recorded schedule" so the value
 * is never mistaken for a prediction.
 */
export function nextGenSignal(nextGenReleaseMonths: number | null): NextGenSignal {
  const months = sanitizeNextGenMonths(nextGenReleaseMonths);
  if (months === null) {
    return {
      status: 'unknown',
      months: null,
      label: 'No release schedule recorded',
    };
  }
  if (months === 0) {
    return {
      status: 'soon',
      months,
      label:
        'Next generation expected this month (recorded schedule) — consider waiting before buying.',
    };
  }
  const noun = months === 1 ? 'month' : 'months';
  if (months <= NEXT_GEN_WAIT_THRESHOLD_MONTHS) {
    return {
      status: 'soon',
      months,
      label: `Next generation expected in ${months} ${noun} (recorded schedule) — consider waiting before buying.`,
    };
  }
  return {
    status: 'later',
    months,
    label: `Next generation expected in ${months} ${noun} (recorded schedule).`,
  };
}

/**
 * Fail-safe read of one product's Option 20 columns. Returns all
 * nulls when the columns/table do not exist yet (migration 023 not
 * run), when RLS blocks the read, or on any error — so callers can
 * render an honest empty state instead of breaking the page. Never
 * throws.
 */
export async function getProductGlobalReadiness(
  supabase: AnySupabaseClient,
  productId: string
): Promise<GlobalReadinessData> {
  const empty: GlobalReadinessData = {
    regionalAvailability: null,
    nextGenReleaseMonths: null,
    globalWarrantyType: null,
  };
  try {
    const { data, error } = await supabase
      .from('products')
      .select('regional_availability, next_gen_release_months, global_warranty_type')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductGlobalReadiness: query failed (023 may not be run)', {
          error: error.message,
        });
      }
      return empty;
    }
    const row = data as Record<string, unknown>;
    return {
      regionalAvailability: sanitizeRegionalAvailability(row.regional_availability),
      nextGenReleaseMonths: sanitizeNextGenMonths(row.next_gen_release_months),
      globalWarrantyType: sanitizeWarrantyType(row.global_warranty_type),
    };
  } catch (err) {
    logger.warn('getProductGlobalReadiness: unexpected error', { error: String(err) });
    return empty;
  }
}
