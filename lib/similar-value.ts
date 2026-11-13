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
  /** Similarity signal (confidence_score, 50 when unrecorded). */
  matchScore: number;
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
