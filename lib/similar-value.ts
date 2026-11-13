/**
 * Value-ranked similar products (Section 19, Phase 4, §12 #47).
 *
 * The similar-products API used to order by `confidence_score`
 * only: discovery worked, but a pricier lookalike outranked a
 * cheaper one with a real recorded saving. This pure ranker orders
 * by VALUE, from real recorded prices only:
 *
 *   1. Recorded saving % (compare-at vs price) — a real discount
 *      beats no discount. Null saving (no compare-at price) ranks
 *      below any real saving, never as 0% pretending to be measured.
 *   2. Lowest recorded price, ascending — among equal savings, the
 *      cheaper product is the better value.
 *   3. Match score, descending — among equal value, the closer
 *      match wins.
 *   4. Slug — deterministic tiebreak.
 *
 * Unpriced products (no recorded price) always rank last: a similar
 * product with no price cannot be a "better value" than one with a
 * price. The Deal Score display gate is respected by callers: this
 * ranker never invents a score, it only orders by the numbers the
 * caller already has (saving % / price / match score).
 */

export interface SimilarValueCandidate {
  slug: string;
  /** Lowest recorded in-stock merchant price, or null when unpriced. */
  price: number | null;
  /** Merchant-basis saving %, or null when no compare-at price exists. */
  savingPct: number | null;
  /** Real similarity 0–100 (see similarityScore) — never a completeness count. */
  matchScore: number;
}

/**
 * Sections 21–25, Stage H (H-P2-7) — a REAL similarity score for
 * "similar products", 0–100, from the things that actually make two
 * products similar: same brand +40, same category +30, price within
 * 20% of the anchor +30 (0 when either price is unknown — an
 * unknown price is not evidence of closeness). Deterministic, no
 * randomness, no invented data. This replaces the old
 * `confidence_score` (a field-presence completeness count, floored
 * at 50) that was presented as a match score.
 */
export function similarityScore(input: {
  anchorBrand: string | null | undefined;
  anchorCategory: string | null | undefined;
  anchorPrice: number | null | undefined;
  brand: string | null | undefined;
  category: string | null | undefined;
  price: number | null | undefined;
}): number {
  const sameText = (a: string | null | undefined, b: string | null | undefined): boolean =>
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.trim() !== '' &&
    a.trim().toLowerCase() === b.trim().toLowerCase();
  let score = 0;
  if (sameText(input.anchorBrand, input.brand)) score += 40;
  if (sameText(input.anchorCategory, input.category)) score += 30;
  const anchor = input.anchorPrice;
  const price = input.price;
  if (
    typeof anchor === 'number' &&
    Number.isFinite(anchor) &&
    anchor > 0 &&
    typeof price === 'number' &&
    Number.isFinite(price) &&
    price > 0 &&
    Math.abs(price - anchor) / anchor <= 0.2
  ) {
    score += 30;
  }
  return score;
}

export function rankSimilarByValue<T extends SimilarValueCandidate>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    // Unpriced last — no price, no value claim.
    const aPriced = a.price !== null && Number.isFinite(a.price);
    const bPriced = b.price !== null && Number.isFinite(b.price);
    if (aPriced !== bPriced) return aPriced ? -1 : 1;
    // Real saving first; null saving below any real saving.
    const aSaving = a.savingPct ?? -1;
    const bSaving = b.savingPct ?? -1;
    if (bSaving !== aSaving) return bSaving - aSaving;
    // Cheaper first among equal savings.
    if (aPriced && bPriced && (a.price as number) !== (b.price as number)) {
      return (a.price as number) - (b.price as number);
    }
    // Closer match first, then slug for determinism.
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return a.slug.localeCompare(b.slug);
  });
}
