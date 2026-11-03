/**
 * AI Product Durability & Longevity Predictor — category ranges plus a
 * review-gated reliability score. It is an ESTIMATE module, not a
 * measurement of any individual product.
 *
 * HONESTY RULES (do not weaken them):
 * - The lifespan shown is a TYPICAL RANGE FOR THE CATEGORY (an
 *   approximate, documented table), explicitly labeled "typical for
 *   this category, not a measurement of this product". It is NEVER
 *   presented as this product's measured lifespan.
 * - The reliability score is shown ONLY when real review data
 *   supports it (see MIN_REVIEWS_FOR_SCORE). Below that gate the UI
 *   reads "insufficient review data — reliability score unavailable"
 *   and shows NO number. The score is the average rating scaled to
 *   0–100, with the verified share shown as context — nothing more.
 * - Price is NEVER used as evidence of durability. (Price may be
 *   shown elsewhere on the page as price context, labeled as such.)
 * - NO repair-log data exists anywhere in this system. The UI must
 *   state plainly "no repair-log data available for this product".
 *   No repair statistics, failure rates, or brand reliability
 *   rankings are ever invented.
 * - If reviews arrive later, the review-based part activates
 *   automatically from the same reviews table — no code change.
 */

/** Typical lifespan range (years) for a product category — approximate. */
export interface LifespanRange {
  minYears: number;
  maxYears: number;
  note: string;
}

/**
 * Documented approximate typical ranges. These are category norms,
 * not measurements of any SmartBuy product, and the UI must say so.
 */
export const CATEGORY_LIFESPAN_YEARS: Record<string, LifespanRange> = {
  Laptops: { minYears: 4, maxYears: 6, note: 'Typical for laptops with normal use.' },
  Phones: { minYears: 3, maxYears: 5, note: 'Typical for smartphones before battery/parts wear dominates.' },
  Headphones: { minYears: 3, maxYears: 5, note: 'Typical for headphones; cables and batteries wear first.' },
  Cameras: { minYears: 5, maxYears: 8, note: 'Typical for cameras; shutters and batteries are the wear items.' },
  Wearables: { minYears: 3, maxYears: 5, note: 'Typical for watches and fitness wearables.' },
  Accessories: { minYears: 2, maxYears: 4, note: 'Typical for accessories; varies widely by type.' },
  Tablets: { minYears: 4, maxYears: 6, note: 'Typical for tablets with normal use.' },
  Monitors: { minYears: 5, maxYears: 8, note: 'Typical for monitors; backlights age over time.' },
};

/** Minimum total reviews before ANY reliability number is shown. */
export const MIN_REVIEWS_FOR_SCORE = 10;

export interface ReliabilityScore {
  /** 0–100, or null when the review gate is not met. */
  score: number | null;
  /** Average rating the score (if any) was derived from. */
  averageRating: number | null;
  /** Total reviews counted. */
  totalReviews: number;
  /** Verified reviews counted (context only). */
  verifiedReviews: number;
}

/** Category range lookup (case-insensitive), or null when unknown. */
export function lifespanForCategory(category: string | null | undefined): LifespanRange | null {
  if (!category) return null;
  const key = Object.keys(CATEGORY_LIFESPAN_YEARS).find(
    (k) => k.toLowerCase() === category.trim().toLowerCase()
  );
  return key ? CATEGORY_LIFESPAN_YEARS[key] : null;
}

/**
 * Reliability score, gated on real review volume. Below the gate the
 * score is null — the UI must render the "unavailable" note, never a
 * number, and never a score derived from price or category.
 */
export function reliabilityFromReviews(input: {
  totalReviews: number;
  averageRating: number | null;
  verifiedReviews: number;
}): ReliabilityScore {
  const total = Math.max(0, Math.floor(input.totalReviews || 0));
  const verified = Math.max(0, Math.floor(input.verifiedReviews || 0));
  const avg =
    input.averageRating !== null && Number.isFinite(input.averageRating)
      ? input.averageRating
      : null;
  if (total < MIN_REVIEWS_FOR_SCORE || avg === null || avg <= 0) {
    return { score: null, averageRating: avg, totalReviews: total, verifiedReviews: verified };
  }
  return {
    score: Math.round((avg / 5) * 100),
    averageRating: avg,
    totalReviews: total,
    verifiedReviews: verified,
  };
}
