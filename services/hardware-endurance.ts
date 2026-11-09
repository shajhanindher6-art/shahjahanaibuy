/**
 * Hardware Endurance, Sustainability & Modularity engine (Option 17).
 *
 * Deterministic, no LLM, no fetch, no scraping. Pure math over values
 * recorded per product in the `products` table (migration 020). Nothing
 * is invented: a product with no recorded hardware data gets NO index
 * and NO score — the UI must show "Not recorded yet".
 *
 * ENDURANCE INDEX (0–100) — approved design 2026-11-09:
 *   index = thermalPoints + tbwPoints + cyclePoints
 *   thermalPoints = round(thermal_efficiency_factor * 40)   (0–40)
 *   tbwPoints    = TBW >= 600 → 30, >= 300 → 20, >= 150 → 10, else 0
 *   cyclePoints  = cycles >= 1000 → 30, >= 800 → 20, >= 500 → 10, else 0
 * Bands: >= 80 Excellent, 60–79 Good, 40–59 Fair, < 40 Poor.
 * An unrecorded input contributes 0 and is flagged (partial) — the
 * index is a lower bound until the missing value is recorded, and the
 * UI must say so. All three missing → index null, band 'unknown'.
 *
 * SUSTAINABILITY — the RECORDED carbon footprint (kg CO2e) is ranked
 * against the same Option 8 category baseline used by the eco
 * ESTIMATE (services/eco-footprint.ts), with the same band thresholds
 * (ratio ≤ 0.7 A+, ≤ 0.9 A, ≤ 1.1 B, ≤ 1.3 C, ≤ 1.6 D, else E). The two
 * are never mixed: this function only ever ranks a RECORDED value.
 * When no carbon value is recorded the result is 'unknown' and the
 * caller shows the honest empty state — the eco ESTIMATE lives in its
 * own module and is never presented as recorded data.
 *
 * MODULARITY — labels derived from the two recorded booleans:
 * both true → Fully modular; one true → Partially modular; both
 * false → Sealed — not upgradeable; both null → Not recorded.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { categoryBaseKg, type EcoBand } from '@/services/eco-footprint';

/** Recorded Option 17 values as stored on the products row (all nullable). */
export interface HardwareEnduranceData {
  /** 0–1 thermal efficiency factor, or null when not recorded. */
  thermalEfficiencyFactor: number | null;
  /** SSD endurance rating in TBW, or null when not recorded. */
  ssdTbwRating: number | null;
  /** Battery cycle capacity, or null when not recorded. */
  batteryCycleCapacity: number | null;
  /** Recorded carbon footprint in kg CO2e, or null when not recorded. */
  carbonFootprintKg: number | null;
  /** True when RAM is user-upgradeable, or null when not recorded. */
  isRamModular: boolean | null;
  /** True when storage is user-upgradeable, or null when not recorded. */
  isStorageModular: boolean | null;
}

export type EnduranceBand = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface EnduranceIndex {
  /** 0–100, or null when nothing is recorded to index. */
  index: number | null;
  band: EnduranceBand;
  thermalPoints: number;
  tbwPoints: number;
  cyclePoints: number;
  hasThermal: boolean;
  hasTbw: boolean;
  hasCycles: boolean;
  /** True when some (but not all) inputs are recorded. */
  partial: boolean;
}

export interface RecordedSustainability {
  /** 'recorded' only when a real carbon value was ranked. */
  status: 'recorded' | 'unknown';
  kgCO2e: number | null;
  band: EcoBand | null;
  categoryBaseKg: number | null;
  ratio: number | null;
}

export type ModularityLabel =
  | 'Fully modular'
  | 'Partially modular'
  | 'Sealed — not upgradeable'
  | 'Not recorded';

export interface ModularityResult {
  label: ModularityLabel;
  ram: 'Modular' | 'Sealed' | 'Not recorded';
  storage: 'Modular' | 'Sealed' | 'Not recorded';
}

function sanitizeThermal(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

function sanitizeNonNegative(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sanitizeBoolean(value: unknown): boolean | null {
  return value === true ? true : value === false ? false : null;
}

/** TBW points: >= 600 → 30, >= 300 → 20, >= 150 → 10, else 0. */
export function tbwPoints(tbwRating: number | null): number {
  if (tbwRating === null || !Number.isFinite(tbwRating)) return 0;
  if (tbwRating >= 600) return 30;
  if (tbwRating >= 300) return 20;
  if (tbwRating >= 150) return 10;
  return 0;
}

/** Battery-cycle points: >= 1000 → 30, >= 800 → 20, >= 500 → 10, else 0. */
export function cyclePoints(cycleCapacity: number | null): number {
  if (cycleCapacity === null || !Number.isFinite(cycleCapacity)) return 0;
  if (cycleCapacity >= 1000) return 30;
  if (cycleCapacity >= 800) return 20;
  if (cycleCapacity >= 500) return 10;
  return 0;
}

/**
 * Endurance index from recorded hardware data. Returns index null +
 * band 'unknown' when all three inputs are unrecorded — never a
 * number from nothing.
 */
export function computeEnduranceIndex(
  input: HardwareEnduranceData
): EnduranceIndex {
  const thermal = sanitizeThermal(input.thermalEfficiencyFactor);
  const tbw = sanitizeNonNegative(input.ssdTbwRating);
  const cycles = sanitizeNonNegative(input.batteryCycleCapacity);

  const hasThermal = thermal !== null;
  const hasTbw = tbw !== null;
  const hasCycles = cycles !== null;
  const recordedCount = [hasThermal, hasTbw, hasCycles].filter(Boolean).length;

  if (recordedCount === 0) {
    return {
      index: null,
      band: 'unknown',
      thermalPoints: 0,
      tbwPoints: 0,
      cyclePoints: 0,
      hasThermal,
      hasTbw,
      hasCycles,
      partial: false,
    };
  }

  const thermalPts = hasThermal && thermal !== null ? Math.round(thermal * 40) : 0;
  const tbwPts = tbwPoints(tbw);
  const cyclePts = cyclePoints(cycles);
  const index = Math.min(100, thermalPts + tbwPts + cyclePts);

  const band: EnduranceBand =
    index >= 80 ? 'excellent' : index >= 60 ? 'good' : index >= 40 ? 'fair' : 'poor';

  return {
    index,
    band,
    thermalPoints: thermalPts,
    tbwPoints: tbwPts,
    cyclePoints: cyclePts,
    hasThermal,
    hasTbw,
    hasCycles,
    partial: recordedCount < 3,
  };
}

/** Band for a recorded-carbon ratio, using the Option 8 thresholds. */
export function bandForRatio(ratio: number): EcoBand {
  if (ratio <= 0.7) return 'A+';
  if (ratio <= 0.9) return 'A';
  if (ratio <= 1.1) return 'B';
  if (ratio <= 1.3) return 'C';
  if (ratio <= 1.6) return 'D';
  return 'E';
}

const RECORDED_BAND_LABEL: Record<EcoBand, string> = {
  'A+': 'A+ — lowest recorded footprint in its category',
  A: 'A — low recorded footprint',
  B: 'B — below-average recorded footprint',
  C: 'C — above-average recorded footprint',
  D: 'D — high recorded footprint',
  E: 'E — highest recorded footprint in its category',
};

/** Human label for a RECORDED-carbon band (never "estimated"). */
export function recordedBandLabel(band: EcoBand): string {
  return RECORDED_BAND_LABEL[band];
}

/**
 * Rank a RECORDED carbon footprint against the product's category
 * baseline. Returns status 'unknown' only when no carbon value is
 * recorded. When a value IS recorded but the category has no baseline,
 * the value is still shown (status 'recorded', band null) — a missing
 * baseline must never hide recorded data.
 */
export function sustainabilityFromRecorded(input: {
  carbonFootprintKg: number | null | undefined;
  category: string | null | undefined;
}): RecordedSustainability {
  const kg = sanitizeNonNegative(input.carbonFootprintKg);
  if (kg === null) {
    return { status: 'unknown', kgCO2e: null, band: null, categoryBaseKg: null, ratio: null };
  }
  const base = categoryBaseKg(input.category);
  if (base === null) {
    return { status: 'recorded', kgCO2e: kg, band: null, categoryBaseKg: null, ratio: null };
  }
  const ratio = Math.round((kg / base) * 100) / 100;
  return { status: 'recorded', kgCO2e: kg, band: bandForRatio(ratio), categoryBaseKg: base, ratio };
}

/** Modularity label derived from the two recorded booleans. */
export function modularityResult(input: HardwareEnduranceData): ModularityResult {
  const ram = sanitizeBoolean(input.isRamModular);
  const storage = sanitizeBoolean(input.isStorageModular);
  const ramLabel = ram === true ? 'Modular' : ram === false ? 'Sealed' : 'Not recorded';
  const storageLabel =
    storage === true ? 'Modular' : storage === false ? 'Sealed' : 'Not recorded';

  let label: ModularityLabel;
  if (ram === null && storage === null) {
    label = 'Not recorded';
  } else if (ram === true && storage === true) {
    label = 'Fully modular';
  } else if (ram === false && storage === false) {
    label = 'Sealed — not upgradeable';
  } else {
    label = 'Partially modular';
  }
  return { label, ram: ramLabel, storage: storageLabel };
}

/**
 * Fail-safe read of one product's Option 17 columns. Returns all
 * nulls when the columns/table do not exist yet (migration 020 not
 * run), when RLS blocks the read, or on any error — so callers can
 * render an honest empty state instead of breaking the page. Never
 * throws.
 */
export async function getProductEndurance(
  supabase: AnySupabaseClient,
  productId: string
): Promise<HardwareEnduranceData> {
  const empty: HardwareEnduranceData = {
    thermalEfficiencyFactor: null,
    ssdTbwRating: null,
    batteryCycleCapacity: null,
    carbonFootprintKg: null,
    isRamModular: null,
    isStorageModular: null,
  };
  try {
    const { data, error } = await supabase
      .from('products')
      .select(
        'thermal_efficiency_factor, ssd_tbw_rating, battery_cycle_capacity, carbon_footprint_kg, is_ram_modular, is_storage_modular'
      )
      .eq('id', productId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logger.warn('getProductEndurance: query failed (020 may not be run)', {
          error: error.message,
        });
      }
      return empty;
    }
    const row = data as Record<string, unknown>;
    return {
      thermalEfficiencyFactor: sanitizeThermal(row.thermal_efficiency_factor),
      ssdTbwRating: sanitizeNonNegative(row.ssd_tbw_rating),
      batteryCycleCapacity: sanitizeNonNegative(row.battery_cycle_capacity),
      carbonFootprintKg: sanitizeNonNegative(row.carbon_footprint_kg),
      isRamModular: sanitizeBoolean(row.is_ram_modular),
      isStorageModular: sanitizeBoolean(row.is_storage_modular),
    };
  } catch (err) {
    logger.warn('getProductEndurance: unexpected error', { error: String(err) });
    return empty;
  }
}
