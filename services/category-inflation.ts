/**
 * Category Inflation Index — pure, computed ONLY from real recorded
 * `price_history` rows. No scraped prices, no invented categories,
 * no seasonal claims.
 *
 * WINDOW RULE (documented, fixed): trailing 90 days. For each
 * product, take its usable recorded points inside the window
 * (finite price > 0, valid date, oldest-first): the per-product
 * change is (latest − earliest) / earliest × 100. A product needs
 * at least 2 usable points in the window to have a change at all.
 * A category's index is the MEAN of its products' per-product
 * change percentages — never a mean of raw prices (a $2,000 laptop
 * must not drown out a $99 accessory). A category is reported ONLY
 * when at least 2 of its products have a valid change; otherwise
 * the entry is an honest "insufficient data" row (avgChangePct null,
 * direction 'unknown'), never a fabricated number.
 *
 * Direction: |avg| < 0.1% counts as 'flat' (noise guard); above
 * that, 'up' / 'down'. Percentages are rounded to 1 decimal.
 */

export interface CategoryPricePoint {
  productId: string;
  /** Legacy text category from the products table (e.g. 'Laptops'). */
  category: string | null | undefined;
  price: number;
  recordedAt: string;
}

export interface CategoryInflationEntry {
  category: string;
  /** Mean per-product % change, 1 decimal; null when insufficient. */
  avgChangePct: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  /** Products in this category with a valid change. */
  productsUsed: number;
  /** Usable price points in the window for this category. */
  pointsUsed: number;
  status: 'ok' | 'insufficient';
}

export interface CategoryInflationIndex {
  entries: CategoryInflationEntry[];
  /** Fixed trailing window, in days. */
  windowDays: number;
  /** Days spanned by the usable input rows (0 when there are none). */
  historyDays: number;
}

export const CATEGORY_INFLATION_WINDOW_DAYS = 90;
/** |avg % change| below this counts as flat (noise guard). */
export const CATEGORY_INFLATION_FLAT_THRESHOLD_PCT = 0.1;
/** A category average needs at least this many products with changes. */
export const CATEGORY_INFLATION_MIN_PRODUCTS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function computeCategoryInflation(
  points: CategoryPricePoint[],
  windowDays: number = CATEGORY_INFLATION_WINDOW_DAYS,
  nowMs: number = Date.now()
): CategoryInflationIndex {
  const cutoff = nowMs - windowDays * DAY_MS;

  // Usable rows only: finite positive price, valid date, inside the
  // window, and attributable to a named category. Invalid rows are
  // dropped, never treated as zero (a zero would fabricate a drop).
  const usable = points.filter(
    (p) =>
      typeof p.category === 'string' &&
      p.category.trim().length > 0 &&
      Number.isFinite(p.price) &&
      p.price > 0 &&
      p.recordedAt &&
      Number.isFinite(toMs(p.recordedAt)) &&
      toMs(p.recordedAt) >= cutoff &&
      toMs(p.recordedAt) <= nowMs
  );

  const historyDays =
    usable.length === 0
      ? 0
      : Math.max(
          0,
          Math.ceil(
            (Math.max(...usable.map((p) => toMs(p.recordedAt))) -
              Math.min(...usable.map((p) => toMs(p.recordedAt)))) /
              DAY_MS
          )
        );

  // Per-product change: earliest vs latest point in the window.
  const byProduct = new Map<string, { category: string; prices: { ms: number; price: number }[] }>();
  for (const p of usable) {
    const key = p.productId;
    let bucket = byProduct.get(key);
    if (!bucket) {
      bucket = { category: (p.category as string).trim(), prices: [] };
      byProduct.set(key, bucket);
    }
    bucket.prices.push({ ms: toMs(p.recordedAt), price: p.price });
  }

  // Category -> per-product change percentages.
  const byCategory = new Map<string, { changes: number[]; pointsUsed: number }>();
  for (const bucket of byProduct.values()) {
    const cat = byCategory.get(bucket.category) ?? { changes: [], pointsUsed: 0 };
    cat.pointsUsed += bucket.prices.length;
    const sorted = [...bucket.prices].sort((a, b) => a.ms - b.ms);
    if (sorted.length >= 2) {
      const first = sorted[0].price;
      const last = sorted[sorted.length - 1].price;
      if (first > 0) {
        cat.changes.push(((last - first) / first) * 100);
      }
    }
    byCategory.set(bucket.category, cat);
  }

  const entries: CategoryInflationEntry[] = Array.from(byCategory, ([category, cat]) => {
    if (cat.changes.length < CATEGORY_INFLATION_MIN_PRODUCTS) {
      return {
        category,
        avgChangePct: null,
        direction: 'unknown' as const,
        productsUsed: cat.changes.length,
        pointsUsed: cat.pointsUsed,
        status: 'insufficient' as const,
      };
    }
    const avg = round1(cat.changes.reduce((s, c) => s + c, 0) / cat.changes.length);
    return {
      category,
      avgChangePct: avg,
      direction:
        avg > CATEGORY_INFLATION_FLAT_THRESHOLD_PCT
          ? ('up' as const)
          : avg < -CATEGORY_INFLATION_FLAT_THRESHOLD_PCT
            ? ('down' as const)
            : ('flat' as const),
      productsUsed: cat.changes.length,
      pointsUsed: cat.pointsUsed,
      status: 'ok' as const,
    };
  }).sort((a, b) => a.category.localeCompare(b.category));

  return { entries, windowDays, historyDays };
}
