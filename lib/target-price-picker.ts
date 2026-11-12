/**
 * Smart Target-Price Picker — pure helpers for
 * /tools/target-price-picker (Section 16, E8 / item 26).
 *
 * The reverse of the Price Alert Simulator (which checks a
 * user-supplied target): this page SUGGESTS targets from recorded
 * price history — the recorded low, a low recorded point, and the
 * last recorded price — each with how often it was seen.
 *
 * Honesty rules (the history is thin: 4 recorded points per
 * product, Amazon only):
 * - Every suggestion is labelled "from N recorded points" and the
 *   page shows the actual points — no percentile is presented as
 *   a statistical claim. The "low recorded point" is simply the
 *   value at the 25% position of the sorted recorded prices, and
 *   it is labelled as exactly that.
 * - "Seen" counts are counts of recorded points at or below the
 *   suggested price — never a probability, never a forecast.
 * - A product with no recorded history gets no suggestions, only
 *   an honest empty state. A product with 1 point suggests only
 *   that point (low = last = that price).
 */

export interface TargetPricePoint {
  price: number;
  recordedAt: string;
}

export interface TargetPriceSuggestion {
  label: string;
  targetUsd: number;
  /** Recorded points at or below this target. */
  pointsAtOrBelow: number;
  /** Total recorded points the suggestion comes from. */
  pointCount: number;
  note: string;
}

export interface TargetPriceSuggestions {
  productId: string;
  pointCount: number;
  points: TargetPricePoint[];
  suggestions: TargetPriceSuggestion[];
}

/** Sort points oldest-first; drops non-finite / non-positive prices. */
export function sortTargetPoints(
  points: Array<{ price: number; recordedAt: string }>
): TargetPricePoint[] {
  return points
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && p.recordedAt)
    .map((p) => ({ price: Math.round(p.price * 100) / 100, recordedAt: p.recordedAt }))
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
}

/**
 * Suggest targets from recorded points. Returns null when there
 * are no usable points.
 */
export function suggestTargetPrices(
  productId: string,
  rawPoints: Array<{ price: number; recordedAt: string }>
): TargetPriceSuggestions | null {
  const points = sortTargetPoints(rawPoints);
  if (points.length === 0) return null;

  const pricesAsc = [...points].map((p) => p.price).sort((a, b) => a - b);
  const lowest = pricesAsc[0];
  // Low recorded point: the value at the 25% position of the
  // sorted recorded prices (index round(0.25 × (n − 1))). With 4
  // points this is the second-lowest — labelled as such.
  const lowIndex = Math.round(0.25 * (pricesAsc.length - 1));
  const lowPoint = pricesAsc[lowIndex];
  const last = points[points.length - 1].price;

  const atOrBelow = (target: number): number =>
    points.filter((p) => p.price <= target + 0.005).length;

  const suggestions: TargetPriceSuggestion[] = [
    {
      label: 'Recorded low',
      targetUsd: lowest,
      pointsAtOrBelow: atOrBelow(lowest),
      pointCount: points.length,
      note: `The lowest price ever recorded for this product, from ${points.length} recorded point${points.length === 1 ? '' : 's'}.`,
    },
  ];
  if (lowPoint !== lowest) {
    suggestions.push({
      label: 'Low recorded point',
      targetUsd: lowPoint,
      pointsAtOrBelow: atOrBelow(lowPoint),
      pointCount: points.length,
      note: `The value at the 25% position of the ${points.length} sorted recorded prices — a low point, not a statistical percentile.`,
    });
  }
  if (last !== lowest && last !== lowPoint) {
    suggestions.push({
      label: 'Last recorded price',
      targetUsd: last,
      pointsAtOrBelow: atOrBelow(last),
      pointCount: points.length,
      note: 'The most recent recorded price. Setting this as a target alerts you only if the price drops below it.',
    });
  }

  return { productId, pointCount: points.length, points, suggestions };
}

/** Parse the page's GET params: ?product=<slug>. */
export function parseTargetPickerParams(searchParams: {
  product?: string | string[];
}): { productSlug: string | null; hasQuery: boolean } {
  const raw = Array.isArray(searchParams.product) ? searchParams.product[0] : searchParams.product;
  return {
    productSlug: raw !== undefined && raw.trim().length > 0 ? raw.trim() : null,
    hasQuery: raw !== undefined,
  };
}
