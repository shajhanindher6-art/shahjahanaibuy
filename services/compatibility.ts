/**
 * Battery & Accessory Compatibility Matrix (Option 10, Feature 5).
 *
 * GRADING RULES (do not weaken them):
 * - "Exact" is NEVER assigned: no compatibility data source exists in
 *   this catalog (no connector/interface fields, no compatibility table).
 * - Same brand + same category → "Likely — same brand and category,
 *   verify connector/specs before buying".
 * - Same category only → "Possible — same category, verify
 *   connector/specs before buying".
 * - Otherwise → "Unknown — check specs".
 * - Connector/charger/hub notes come ONLY from real spec fields when
 *   present. This catalog records only brand/category/GTIN/confidence,
 *   so in practice the note is always "connector info not recorded for
 *   this product" — never an invented connector, voltage, or wattage.
 * - Candidates are REAL catalog products (from the similar-products
 *   endpoint), never invented accessories.
 */

export type CompatibilityGrade = 'Likely' | 'Possible' | 'Unknown';

export interface CompatibilityCandidate {
  slug: string;
  name: string;
  brand: string | null;
  category: string | null;
  priceUsd: number | null;
}

export interface GradedCandidate extends CompatibilityCandidate {
  grade: CompatibilityGrade;
  gradeNote: string;
}

export function gradeCompatibility(
  product: { brand: string | null; category: string | null },
  candidate: CompatibilityCandidate
): GradedCandidate {
  const sameBrand =
    !!product.brand &&
    !!candidate.brand &&
    product.brand.toLowerCase() === candidate.brand.toLowerCase();
  const sameCategory =
    !!product.category &&
    !!candidate.category &&
    product.category.toLowerCase() === candidate.category.toLowerCase();

  if (sameBrand && sameCategory) {
    return {
      ...candidate,
      grade: 'Likely',
      gradeNote: 'Same brand and category — verify connector/specs before buying.',
    };
  }
  if (sameCategory) {
    return {
      ...candidate,
      grade: 'Possible',
      gradeNote: 'Same category — verify connector/specs before buying.',
    };
  }
  return {
    ...candidate,
    grade: 'Unknown',
    gradeNote: 'Compatibility unknown — check specs before buying.',
  };
}

/** Connector note: only from a real spec field, otherwise the honest fallback. */
export function connectorNote(specText: string | null): string {
  if (specText && /usb-c|usb c|lightning|micro-usb|hdmi|bluetooth/i.test(specText)) {
    return specText;
  }
  return 'Connector info not recorded for this product — check the manufacturer specs before buying.';
}
