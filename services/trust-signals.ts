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
  /**
   * Section 19, Phase 2 (§12 #19) — recorded price history for
   * time-series anomaly detection (spike/drop + flatline).
   * Optional: when absent the time-series checks simply do not
   * run (no signal is invented). Points are { price, recordedAt }
   * from price_history, any order.
   */
  priceHistory?: Array<{ price: number; recordedAt: string }>;
  /**
   * Section 19, Phase 2 (§12 #19) — latest recorded price per
   * priced merchant, for the cross-merchant outlier check.
   * Optional: with fewer than 2 merchants the check cannot run
   * and adds no signal.
   */
  merchantPrices?: Array<{ merchant: string; price: number }>;
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

/**
 * Section 19, Phase 2 (§12 #19) — time-series anomaly
 * thresholds (stated, change them here and the UI text follows).
 * - A single consecutive move of ≥25% up or down is a spike/drop:
 *   real prices move, but a quarter of the price in one recorded
 *   step deserves a caution, never a silent priceChange.
 * - A run of ≥3 consecutive recordings at the SAME price is a
 *   flatline: identical points otherwise render as a $0 change
 *   with no comment, which reads as a stable market when it may
 *   be a stale feed. A run of exactly 2 identical points is too
 *   little to call a flatline — it is reported as unknown
 *   (cannot tell a flat market from a stale feed), not as a
 *   caution.
 * - A merchant price ≥50% below the cross-merchant median (same
 *   50% bar as the category-average check) is an outlier.
 * Every flag names the anomaly type + the evidence (prices,
 * dates, counts) and never invents a cause.
 */
export const TIME_SERIES_SPIKE_THRESHOLD = 0.25; // 25% single-step move
export const FLATLINE_MIN_RUN = 3; // consecutive identical recordings
export const CROSS_MERCHANT_OUTLIER_THRESHOLD = 0.5; // 50% below median

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : iso;
}

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

  // (e) Time-series anomalies — spike/drop + flatline (Section 19,
  // Phase 2 §12 #19). Only runs when recorded history is supplied;
  // with no history there is simply no signal, never a guess.
  // The flags name the anomaly type + the evidence, never a cause
  // (a spike may be a real sale; a flatline may be a stable
  // market — the pattern is reported, the cause is not invented).
  const history = (input.priceHistory ?? [])
    .map((p) => ({ price: p.price, time: new Date(p.recordedAt).getTime(), at: p.recordedAt }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (history.length >= 2) {
    // Spike / drop: largest single consecutive move.
    let worst: { from: number; to: number; at: string; change: number } | null = null;
    for (let i = 1; i < history.length; i++) {
      const from = history[i - 1].price;
      const to = history[i].price;
      const change = (to - from) / from;
      if (Math.abs(change) >= TIME_SERIES_SPIKE_THRESHOLD) {
        if (!worst || Math.abs(change) > Math.abs(worst.change)) {
          worst = { from, to, at: history[i].at, change };
        }
      }
    }
    if (worst) {
      const dir = worst.change > 0 ? 'spike' : 'drop';
      const pct = Math.round(Math.abs(worst.change) * 100);
      signals.push({
        kind: 'price',
        ok: false,
        detail:
          `Caution: price ${dir} of ${pct}% in one recorded step ` +
          `(${money(worst.from)} → ${money(worst.to)} on ${shortDate(worst.at)}) — ` +
          `an unusually large move. Verify the listing before buying.`,
      });
    }

    // Flatline: longest run of consecutive identical prices.
    let longest = 1;
    let run = 1;
    let longestEnd = history[0];
    for (let i = 1; i < history.length; i++) {
      if (history[i].price === history[i - 1].price) {
        run++;
        if (run > longest) {
          longest = run;
          longestEnd = history[i];
        }
      } else {
        run = 1;
      }
    }
    if (longest >= FLATLINE_MIN_RUN) {
      signals.push({
        kind: 'price',
        ok: false,
        detail:
          `Caution: price flatline — ${longest} consecutive recordings at the same price ` +
          `(${money(longestEnd.price)}, latest ${shortDate(longestEnd.at)}). Identical points ` +
          `otherwise show as a $0 price change with no comment; a flat series may be a ` +
          `stable market or a stale feed, and the data cannot tell which.`,
      });
    } else if (longest === 2) {
      signals.push({
        kind: 'price',
        ok: false,
        detail:
          'Only 2 consecutive recordings at the same price — too few to tell a flat market from a stale feed; the $0 price change is not evidence either way.',
        unknown: true,
      });
    }
  }

  // (f) Cross-merchant outlier — one merchant far below the rest
  // (Section 19, Phase 2 §12 #19). Needs ≥2 merchant prices;
  // with one merchant the check cannot run and adds no signal.
  const merchantPrices = (input.merchantPrices ?? []).filter(
    (m) => Number.isFinite(m.price) && m.price > 0
  );
  if (merchantPrices.length >= 2) {
    const sorted = [...merchantPrices].sort((a, b) => a.price - b.price);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 1
        ? sorted[mid].price
        : (sorted[mid - 1].price + sorted[mid].price) / 2;
    const outliers = merchantPrices.filter(
      (m) => (median - m.price) / median >= CROSS_MERCHANT_OUTLIER_THRESHOLD
    );
    if (outliers.length > 0) {
      for (const o of outliers) {
        const pct = Math.round(((median - o.price) / median) * 100);
        signals.push({
          kind: 'price',
          ok: false,
          detail:
            `Caution: ${o.merchant} lists this at ${money(o.price)}, ${pct}% below the ` +
            `median across ${merchantPrices.length} merchants (${money(median)}) — unusually low. ` +
            `Verify the seller and listing before buying.`,
        });
      }
    }
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
      'Trust score = (clean signals ÷ judged signals) × 100, over seller, review-pattern, price, and image signals that could actually be judged. Unknown signals are excluded, never counted as clean. When recorded price history is supplied, time-series anomaly signals (spike/drop, flatline, cross-merchant outlier) are judged alongside the price check.',
  };
}
