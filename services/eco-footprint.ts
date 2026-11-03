/**
 * Eco-footprint estimation (Option 8, Feature 1).
 *
 * HONESTY CONTRACT — read before changing numbers:
 * - These are APPROXIMATE lifecycle proxies, not measured product data and
 *   NOT a certification. The UI must always label the result "Estimated"
 *   and state "not a certified lifecycle assessment".
 * - Formula (stated, deterministic): estimate = categoryBase × priceFactor,
 *   where priceFactor = 0.7 + min(priceUsd, 2000) / 2000 × 0.6, i.e. a
 *   0.7–1.3 scaling that lets pricier items in a category score worse.
 *   The price is a proxy for material/energy intensity, nothing more.
 * - Category bases are rough order-of-magnitude proxies for a single unit
 *   (manufacturing + typical shipping), chosen to be comparable WITHIN the
 *   catalogue, not to be quoted as scientific measurements. If a category
 *   is unknown, estimation returns null — never a guessed number.
 * - The sustainability band compares the estimate to its own category base:
 *   ratio ≤ 0.7 → A+, ≤ 0.9 → A, ≤ 1.1 → B, ≤ 1.3 → C, ≤ 1.6 → D, else E.
 *   A band is a relative ranking inside the catalogue, not an eco-label.
 */

export type EcoBand = 'A+' | 'A' | 'B' | 'C' | 'D' | 'E';

/** Approximate kg CO2e baseline per unit, by catalogue category. */
export const CATEGORY_BASE_KG: Record<string, number> = {
  laptops: 250,
  phones: 70,
  'smartphones': 70,
  headphones: 25,
  audio: 25,
  cameras: 60,
  wearables: 30,
  watches: 30,
  accessories: 10,
  keyboards: 12,
  mice: 8,
  tablets: 110,
  consoles: 90,
  drones: 80,
};

function normalizeCategory(category: string | null | undefined): string {
  return (category ?? '').trim().toLowerCase();
}

/** Category baseline in kg CO2e, or null when the category is unknown. */
export function categoryBaseKg(category: string | null | undefined): number | null {
  const key = normalizeCategory(category);
  if (!key) return null;
  if (key in CATEGORY_BASE_KG) return CATEGORY_BASE_KG[key];
  // Fall back to a contained match ("laptop accessories" → laptops, etc.).
  for (const [known, base] of Object.entries(CATEGORY_BASE_KG)) {
    if (key.includes(known) || known.includes(key)) return base;
  }
  return null;
}

export interface EcoEstimate {
  kgCO2e: number;
  band: EcoBand;
  categoryBaseKg: number;
  priceFactor: number;
}

/**
 * Estimated footprint for one product. Returns null when the category is
 * unknown or no usable price is available — callers must render
 * "cannot estimate for this product" in that case, never a number.
 */
export function estimateFootprint(
  category: string | null | undefined,
  priceUsd: number | null | undefined
): EcoEstimate | null {
  const base = categoryBaseKg(category);
  if (base === null) return null;
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }
  const priceFactor = 0.7 + (Math.min(priceUsd, 2000) / 2000) * 0.6;
  const kgCO2e = Math.round(base * priceFactor * 10) / 10;
  const ratio = kgCO2e / base;
  const band: EcoBand =
    ratio <= 0.7 ? 'A+' : ratio <= 0.9 ? 'A' : ratio <= 1.1 ? 'B' : ratio <= 1.3 ? 'C' : ratio <= 1.6 ? 'D' : 'E';
  return { kgCO2e, band, categoryBaseKg: base, priceFactor: Math.round(priceFactor * 100) / 100 };
}

const BAND_LABEL: Record<EcoBand, string> = {
  'A+': 'A+ — lowest estimated footprint in its category',
  A: 'A — low estimated footprint',
  B: 'B — below-average estimated footprint',
  C: 'C — above-average estimated footprint',
  D: 'D — high estimated footprint',
  E: 'E — highest estimated footprint in its category',
};

export function bandLabel(band: EcoBand): string {
  return BAND_LABEL[band];
}
