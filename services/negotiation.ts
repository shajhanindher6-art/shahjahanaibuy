/**
 * AI Price Negotiator — gap analysis + message draft ONLY.
 *
 * HONESTY RULES (do not weaken them):
 * - SmartBuy CANNOT negotiate with retailers directly and has no
 *   retailer partnership. There is no "negotiated" outcome, no
 *   "unlisted" coupon, and no hidden price anywhere in this module.
 * - Everything here is computed from REAL data the caller passes in:
 *   the cheapest current merchant price and the product's REAL
 *   recorded price_history points (same endpoint the trend graph
 *   uses). A target below every recorded price is flagged as such —
 *   it is not dressed up as achievable.
 * - The only "automation" is: (a) the gap math, (b) a polite,
 *   copyable message draft the user sends to the seller THEMSELVES,
 *   and (c) a shortcut to the existing price-alert dialog at the
 *   target price. Nothing is ever sent to a retailer by SmartBuy.
 */

export interface PricePoint {
  price: number;
  recordedAt: string;
}

export interface NegotiationGap {
  /** Cheapest current merchant price (USD), or null when unknown. */
  currentCheapestUsd: number | null;
  /** Lowest ever recorded price (USD), or null when no history. */
  lowestRecordedUsd: number | null;
  /** Average of recorded prices (USD), or null when no history. */
  averageRecordedUsd: number | null;
  /** Number of recorded points the analysis used. */
  pointsUsed: number;
  /** User's target price (USD). */
  targetUsd: number;
  /** target - current cheapest; negative means the target is below today. */
  gapVsCurrentUsd: number | null;
  /** Gap vs current as a percent of the current price (null if unknown). */
  gapVsCurrentPct: number | null;
  /** True when the target is below every price ever recorded. */
  belowEveryRecordedPrice: boolean;
  /** True when the target is already met by today's cheapest price. */
  alreadyMet: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pure gap analysis. Invalid targets (<= 0, NaN) return null so the
 * UI shows a validation note instead of a fabricated analysis.
 */
export function analyzeNegotiationGap(
  currentCheapestUsd: number | null,
  history: PricePoint[],
  targetUsd: number
): NegotiationGap | null {
  if (!Number.isFinite(targetUsd) || targetUsd <= 0) return null;
  const prices = history
    .map((p) => Number(p.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  const lowest = prices.length > 0 ? Math.min(...prices) : null;
  const average =
    prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const current =
    currentCheapestUsd !== null && Number.isFinite(currentCheapestUsd) && currentCheapestUsd > 0
      ? currentCheapestUsd
      : null;
  const gapVsCurrent = current !== null ? round2(targetUsd - current) : null;
  const gapPct =
    current !== null && current > 0 && gapVsCurrent !== null
      ? round2((gapVsCurrent / current) * 100)
      : null;
  return {
    currentCheapestUsd: current,
    lowestRecordedUsd: lowest,
    averageRecordedUsd: average !== null ? round2(average) : null,
    pointsUsed: prices.length,
    targetUsd: round2(targetUsd),
    gapVsCurrentUsd: gapVsCurrent,
    gapVsCurrentPct: gapPct,
    belowEveryRecordedPrice: lowest !== null && targetUsd < lowest,
    alreadyMet: current !== null && targetUsd >= current,
  };
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Polite, copyable message draft for the user to send to the seller
 * themselves. It states only facts (product, current price, target)
 * and asks — it never claims SmartBuy negotiated anything, and it
 * never mentions a coupon, discount, or hidden price that does not
 * exist. The optional reason is the user's own words.
 */
export function buildNegotiationDraft(input: {
  productName: string;
  gap: NegotiationGap;
  reason?: string;
}): string {
  const { productName, gap, reason } = input;
  const lines = [
    `Hi, I'm interested in buying the ${productName}.`,
    gap.currentCheapestUsd !== null
      ? `I see it listed at ${usd(gap.currentCheapestUsd)} right now.`
      : `I'm looking to buy it soon.`,
    `Would you consider ${usd(gap.targetUsd)}?`,
  ];
  if (gap.lowestRecordedUsd !== null && !gap.belowEveryRecordedPrice) {
    lines.push(
      `I've seen it around ${usd(gap.lowestRecordedUsd)} before, so I wanted to ask before ordering.`
    );
  }
  if (reason && reason.trim()) {
    lines.push(`For context: ${reason.trim()}`);
  }
  lines.push(
    `No worries at all if that's not possible — I just wanted to ask. Thanks for your time!`
  );
  return lines.join(' ');
}
