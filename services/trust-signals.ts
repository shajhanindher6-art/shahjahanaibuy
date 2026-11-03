/**
 * Counterfeit & scam detector (Option 8, Feature 4) — REAL signals only.
 *
 * VERDICT VOCABULARY (restricted, never exceeded):
 * - "No scam signals detected" — every checkable signal is clean.
 * - "Caution — <specific real reason>" — a stated, data-backed reason.
 * - "Insufficient data" — there is not enough real signal to judge.
 *
 * NEVER labels a real merchant or product as fake/scam/counterfeit.
 * A numeric trust score is only shown when its formula and inputs are
 * stated (see trustScore below); with no usable inputs there is no score.
 */

export type TrustVerdict = 'clean' | 'caution' | 'insufficient';

export interface TrustSignal {
  kind: 'seller' | 'reviews' | 'price' | 'image';
  ok: boolean;
  /** Plain-language finding; 'unknown' when the signal cannot be judged. */
  detail: string;
  unknown?: boolean;
}

export interface TrustInput {
  /** Merchant names on the product's priced listings (real data). */
  merchantNames: string[];
  /** Known-retailer names. Priced listings come from the merchants table, so
   *  every priced merchant is a known retailer by construction; a name
   *  outside this set would be treated as an unknown seller. */
  knownRetailers: string[];
  totalReviews: number;
  /** rating → count, e.g. { 5: 12, 4: 3 }. */
  ratingDistribution: Record<number, number>;
  /** Cheapest priced listing, USD, or null when unpriced. */
  priceUsd: number | null;
  /** Average cheapest price of same-category products, or null. */
  categoryAverageUsd: number | null;
  /** Product image URL, or null for the placeholder state. */
  imageUrl: string | null;
}

export interface TrustResult {
  verdict: TrustVerdict;
  verdictLabel: string;
  signals: TrustSignal[];
  /** 0–100 only when at least one signal is judgeable; null otherwise. */
  trustScore: number | null;
  trustScoreFormula: string;
}

const PRICE_ANOMALY_THRESHOLD = 0.5; // 50% below category average
const REVIEW_SKEW_MIN_REVIEWS = 10;
const REVIEW_SKEW_FIVE_STAR_SHARE = 0.9; // ≥90% five-star with ≥10 reviews

export function analyzeTrust(input: TrustInput): TrustResult {
  const signals: TrustSignal[] = [];

  // (a) Seller trust: priced merchants are merchants-table retailers.
  const unknownSellers = input.merchantNames.filter(
    (n) => !input.knownRetailers.some((k) => k.toLowerCase() === n.toLowerCase())
  );
  if (input.merchantNames.length === 0) {
    signals.push({
      kind: 'seller',
      ok: false,
      detail: 'No priced merchant listings to check the seller against.',
      unknown: true,
    });
  } else if (unknownSellers.length > 0) {
    signals.push({
      kind: 'seller',
      ok: false,
      detail: `Caution: listing includes seller(s) outside the known-retailer list: ${unknownSellers.join(', ')}. Verify the seller before buying.`,
    });
  } else {
    signals.push({
      kind: 'seller',
      ok: true,
      detail: `Listed by known retailer(s): ${input.merchantNames.join(', ')}. No seller concern detected.`,
    });
  }

  // (b) Review-pattern analysis over REAL reviews only.
  if (input.totalReviews === 0) {
    signals.push({
      kind: 'reviews',
      ok: false,
      detail: 'Not enough reviews to analyze review patterns (0 reviews).',
      unknown: true,
    });
  } else {
    const five = input.ratingDistribution[5] ?? 0;
    const share = input.totalReviews > 0 ? five / input.totalReviews : 0;
    if (input.totalReviews >= REVIEW_SKEW_MIN_REVIEWS && share >= REVIEW_SKEW_FIVE_STAR_SHARE) {
      signals.push({
        kind: 'reviews',
        ok: false,
        detail: `Caution: ${Math.round(share * 100)}% of ${input.totalReviews} reviews are 5-star, an unusually skewed pattern — read reviews critically.`,
      });
    } else {
      signals.push({
        kind: 'reviews',
        ok: true,
        detail: `Review pattern looks ordinary across ${input.totalReviews} review(s) (5-star share ${Math.round(share * 100)}%).`,
      });
    }
  }

  // (c) Price-anomaly caution — a caution, never an accusation.
  if (input.priceUsd === null || input.categoryAverageUsd === null) {
    signals.push({
      kind: 'price',
      ok: false,
      detail: 'Cannot compare this price against a category average (missing price data).',
      unknown: true,
    });
  } else {
    const deviation = (input.categoryAverageUsd - input.priceUsd) / input.categoryAverageUsd;
    if (deviation >= PRICE_ANOMALY_THRESHOLD) {
      signals.push({
        kind: 'price',
        ok: false,
        detail: `Caution: this price is ${Math.round(deviation * 100)}% below the category average ($${input.categoryAverageUsd.toFixed(2)}) — unusually low. Verify the seller and listing before buying.`,
      });
    } else {
      signals.push({
        kind: 'price',
        ok: true,
        detail: `Price is within the normal range for its category (category average $${input.categoryAverageUsd.toFixed(2)}).`,
      });
    }
  }

  // (d) Image-listing verification — presence only, never authenticity.
  if (!input.imageUrl) {
    signals.push({
      kind: 'image',
      ok: false,
      detail: 'Listing image not verifiable — this product uses a placeholder image.',
      unknown: true,
    });
  } else {
    signals.push({
      kind: 'image',
      ok: true,
      detail: 'A product image is present. Image presence alone does not prove authenticity.',
    });
  }

  const judged = signals.filter((s) => !s.unknown);
  const failed = signals.filter((s) => !s.ok && !s.unknown);
  // Strict rule: "clean" requires ALL FOUR signals judged clean. Any
  // unjudgeable signal (e.g. 0 reviews, placeholder image) caps the
  // verdict at "insufficient" — claiming "no scam signals" while two
  // signals could not be checked at all would overstate the evidence.
  const verdict: TrustVerdict =
    failed.length > 0 ? 'caution' : signals.some((s) => s.unknown) ? 'insufficient' : 'clean';
  const verdictLabel =
    verdict === 'clean'
      ? 'No scam signals detected'
      : verdict === 'caution'
        ? `Caution — ${failed.map((f) => f.detail).join(' ')}`
        : 'Insufficient data — not enough real signals to judge this listing';
  const trustScore =
    judged.length === 0 ? null : Math.round((judged.filter((s) => s.ok).length / judged.length) * 100);

  return {
    verdict,
    verdictLabel,
    signals,
    trustScore,
    trustScoreFormula:
      'Trust score = (clean signals ÷ judged signals) × 100, over seller, review-pattern, price, and image signals that could actually be judged. Unknown signals are excluded, never counted as clean.',
  };
}
