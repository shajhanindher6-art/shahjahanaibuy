/**
 * AI Price-Drop Digest — Section 7, item 10 (pure, deterministic).
 *
 * A digest covers ONLY products the user watches (their active alerts).
 * For each watched product it looks at recorded `price_history` points
 * in the digest window (last 24h for daily, last 7d for weekly) and
 * reports a drop only when the latest recorded price sits below the
 * 30-day average recorded before the window started.
 *
 * HONESTY: no product the user does not watch ever appears; a product
 * with no recent drop, no baseline, or no history in range is simply
 * absent — never invented, never padded. Every deal carries a one-line
 * reason explaining WHY it is a deal, with the recorded numbers.
 */

export type DigestFrequency = 'daily' | 'weekly';

export interface WatchedProductInput {
  productId: string;
  productSlug?: string | null;
  productName?: string | null;
}

export interface PriceHistoryPointInput {
  productId: string;
  price: number;
  recordedAt: string;
}

export interface DigestDeal {
  productId: string;
  productSlug: string | null;
  productName: string | null;
  currentPrice: number;
  /** 30-day average recorded before the window started. */
  average30d: number;
  /** How far below the 30-day average the current price sits, in percent. */
  percentBelowAverage: number;
  /** Drop in dollars versus the 30-day average. */
  dropVsAverageUsd: number;
  /** Latest recorded price before the window started, when one exists. */
  previousPrice: number | null;
  /** Drop in percent versus the previous recorded price, when one exists. */
  percentVsPrevious: number | null;
  /** ISO date of the latest recorded point in the window. */
  latestRecordedAt: string;
  /** One line explaining why this is a deal, with the recorded numbers. */
  reason: string;
}

export interface PriceDropDigest {
  frequency: DigestFrequency;
  windowDays: number;
  generatedAt: string;
  /** Number of products the user watches (active alerts). */
  watchedCount: number;
  /** Deals, best (furthest below its 30-day average) first. */
  deals: DigestDeal[];
}

export const DIGEST_WINDOW_DAYS: Record<DigestFrequency, number> = {
  daily: 1,
  weekly: 7,
};

export const DIGEST_BASELINE_DAYS = 30;

export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function isValidPoint(point: PriceHistoryPointInput): boolean {
  return (
    !!point &&
    typeof point.productId === 'string' &&
    point.productId !== '' &&
    typeof point.price === 'number' &&
    Number.isFinite(point.price) &&
    point.price > 0 &&
    typeof point.recordedAt === 'string' &&
    Number.isFinite(toMs(point.recordedAt))
  );
}

/**
 * Build a digest for the user's watched products from recorded price
 * history. Pure: no I/O, no invented prices. `nowMs` is injectable so
 * tests can pin "now" — callers pass Date.now() in production.
 */
export function buildPriceDropDigest(
  watched: WatchedProductInput[],
  history: PriceHistoryPointInput[],
  frequency: DigestFrequency,
  nowMs: number = Date.now()
): PriceDropDigest {
  const windowDays = DIGEST_WINDOW_DAYS[frequency];
  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const baselineStartMs = nowMs - DIGEST_BASELINE_DAYS * 24 * 60 * 60 * 1000;

  const pointsByProduct = new Map<string, PriceHistoryPointInput[]>();
  for (const point of history ?? []) {
    if (!isValidPoint(point)) continue;
    const list = pointsByProduct.get(point.productId) ?? [];
    list.push(point);
    pointsByProduct.set(point.productId, list);
  }
  for (const list of pointsByProduct.values()) {
    list.sort((a, b) => toMs(a.recordedAt) - toMs(b.recordedAt));
  }

  const deals: DigestDeal[] = [];
  const seen = new Set<string>();
  for (const product of watched ?? []) {
    if (!product || typeof product.productId !== 'string' || !product.productId) continue;
    if (seen.has(product.productId)) continue;
    seen.add(product.productId);
    const points = pointsByProduct.get(product.productId) ?? [];
    if (points.length === 0) continue;

    const inWindow = points.filter((p) => toMs(p.recordedAt) >= windowStartMs);
    if (inWindow.length === 0) continue;
    const current = inWindow[inWindow.length - 1];

    // Baseline: recorded points in the 30 days before the window
    // started. Fall back to ANY point before the window when the
    // 30-day slice is empty (thin history) — still recorded data,
    // never a guess. With no prior point at all there is no baseline
    // and no deal can be claimed.
    const beforeWindow = points.filter((p) => toMs(p.recordedAt) < windowStartMs);
    let baseline = beforeWindow.filter((p) => toMs(p.recordedAt) >= baselineStartMs);
    if (baseline.length === 0) baseline = beforeWindow;
    if (baseline.length === 0) continue;
    const average30d =
      baseline.reduce((sum, p) => sum + p.price, 0) / baseline.length;

    if (!(current.price < average30d)) continue;

    const previousPrice = beforeWindow.length > 0 ? beforeWindow[beforeWindow.length - 1].price : null;
    const percentBelowAverage = ((average30d - current.price) / average30d) * 100;
    const percentVsPrevious =
      previousPrice !== null && previousPrice > 0
        ? ((previousPrice - current.price) / previousPrice) * 100
        : null;

    const name = product.productName ?? product.productSlug ?? product.productId;
    let reason =
      `${name} is ${percentBelowAverage.toFixed(1)}% below its 30-day average — $${roundToCents(current.price).toFixed(2)} now versus a $${roundToCents(average30d).toFixed(2)} average.`;
    if (percentVsPrevious !== null && percentVsPrevious > 0) {
      reason += ` It is also ${percentVsPrevious.toFixed(1)}% down from the previous recorded price of $${roundToCents(previousPrice as number).toFixed(2)}.`;
    }

    deals.push({
      productId: product.productId,
      productSlug: product.productSlug ?? null,
      productName: product.productName ?? null,
      currentPrice: roundToCents(current.price),
      average30d: roundToCents(average30d),
      percentBelowAverage: Math.round(percentBelowAverage * 10) / 10,
      dropVsAverageUsd: roundToCents(average30d - current.price),
      previousPrice: previousPrice === null ? null : roundToCents(previousPrice),
      percentVsPrevious:
        percentVsPrevious === null ? null : Math.round(percentVsPrevious * 10) / 10,
      latestRecordedAt: current.recordedAt,
      reason,
    });
  }

  deals.sort(
    (a, b) => b.percentBelowAverage - a.percentBelowAverage || a.productId.localeCompare(b.productId)
  );

  return {
    frequency,
    windowDays,
    generatedAt: new Date(nowMs).toISOString(),
    watchedCount: seen.size,
    deals,
  };
}
