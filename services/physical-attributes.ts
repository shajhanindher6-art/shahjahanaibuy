/**
 * Physical attributes engine (Option 18).
 *
 * Deterministic, no LLM, no fetch, no scraping. Pure math over values
 * recorded per product in the `products` table (migration 021).
 * Nothing is invented: a product with no recorded weight or power
 * draw gets NO derived figures — the UI must show "Not recorded yet".
 *
 * ANNUAL ENERGY (kWh/year) = power_draw_watts × 8 hours/day × 365 / 1000.
 * The 8h/day is a stated assumption, labeled on every render — it is
 * not a measured usage figure. Cost is computed ONLY from a tariff
 * the shopper types in themselves (local input, never sent or stored):
 * there is no tariff table anywhere in the codebase, so no tariff is
 * ever invented or assumed.
 *
 * HEAVY ITEM — a stated design rule, not a shipping rate: weight
 * >= 10 kg shows "Heavy item — check shipping before checkout".
 * No shipping cost is ever estimated from weight; no shipping-rate
 * data exists.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

/** Recorded Option 18 values as stored on the products row (all nullable). */
export interface PhysicalAttributesData {
  /** Item weight in kg, or null when not recorded. */
  itemWeightKg: number | null;
  /** Power draw in watts, or null when not recorded. */
  powerDrawWatts: number | null;
}

/** Weight at or above which the heavy-item note shows. */
export const HEAVY_ITEM_WEIGHT_KG = 10;
/** Assumed daily use for the annual-energy estimate (labeled in the UI). */
export const DAILY_USE_HOURS = 8;

function sanitizeNonNegative(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Annual energy use in kWh/year at the stated daily-use assumption.
 * Returns null when no power draw is recorded — never a number
 * from nothing.
 */
export function computeAnnualEnergyKwh(powerDrawWatts: number | null): number | null {
  const watts = sanitizeNonNegative(powerDrawWatts);
  if (watts === null) return null;
  return Math.round(((watts * DAILY_USE_HOURS * 365) / 1000) * 10) / 10;
}

/**
 * Annual running cost from a shopper-supplied tariff ($/kWh).
 * The tariff comes from the shopper's own input only; a null/invalid
 * tariff returns null — no tariff is ever assumed.
 */
export function computeAnnualCost(
  powerDrawWatts: number | null,
  tariffPerKwh: number | null
): number | null {
  const kwh = computeAnnualEnergyKwh(powerDrawWatts);
  if (kwh === null) return null;
  if (tariffPerKwh === null || !Number.isFinite(tariffPerKwh) || tariffPerKwh < 0) return null;
  return Math.round(kwh * tariffPerKwh * 100) / 100;
}

/** Heavy-item note for a recorded weight, or null when not heavy/unrecorded. */
export function heavyItemNote(itemWeightKg: number | null): string | null {
  const kg = sanitizeNonNegative(itemWeightKg);
  if (kg === null || kg < HEAVY_ITEM_WEIGHT_KG) return null;
  return 'Heavy item — check shipping before checkout.';
}

/**
 * Fail-safe read of one product's Option 18 columns. Returns all
 * nulls when the columns/table do not exist yet (migration 021 not
 * run), when RLS blocks the read, or on any error — so callers can
 * render an honest empty state instead of breaking the page. Never
 * throws.
 */
export async function getProductPhysical(
  supabase: AnySupabaseClient,
  productId: string
): Promise<PhysicalAttributesData> {
  const empty: PhysicalAttributesData = { itemWeightKg: null, powerDrawWatts: null };
  try {
    const { data, error } = await supabase
      .from('products')
      .select('item_weight_kg, power_draw_watts')
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductPhysical: query failed (021 may not be run)', {
          error: error.message,
        });
      }
      return empty;
    }
    const row = data as Record<string, unknown>;
    return {
      itemWeightKg: sanitizeNonNegative(row.item_weight_kg),
      powerDrawWatts: sanitizeNonNegative(row.power_draw_watts),
    };
  } catch (err) {
    logger.warn('getProductPhysical: unexpected error', { error: String(err) });
    return empty;
  }
}
