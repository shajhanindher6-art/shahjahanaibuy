/**
 * SmartBuy Price Index — pure, computed ONLY from recorded
 * `price_history` rows. Never from seed/demo prices presented as
 * live, never from scraped or invented prices.
 *
 * METHOD (documented, fixed):
 * - Points are grouped by category × region. Region comes from the
 *   retailer's recorded `country` (retailers.country, default 'US');
 *   'GLOBAL' means all regions pooled, not a region of its own.
 * - Months are UTC calendar months (YYYY-MM) of `recorded_at`.
 * - For each product, its mean recorded price per month is taken
 *   first. A product's monthly ratio is (its month mean) / (its
 *   base-month mean), where the base month is the earliest month
 *   with recorded prices for that category × region group.
 * - The index for a month is 100 × the MEAN of its products'
 *   ratios — never a mean of raw prices (a $2,000 laptop must not
 *   drown out a $99 accessory). The base month itself is 100.0 by
 *   construction whenever it has ≥ 2 products.
 * - A month is published ONLY when at least
 *   PRICE_INDEX_MIN_PRODUCTS products have a ratio for it;
 *   otherwise the entry is an honest 'insufficient' row
 *   (indexValue null), never a fabricated number. Every entry
 *   carries its depth — productsUsed and pointsUsed — so thin data
 *   is visible, never hidden.
 * - Percentages are rounded to 1 decimal; index values to 1 decimal.
 *
 * The index is monthly by design (Section 5 item 5): with ~30 days
 * of recorded history today, the first months will mostly read
 * 'insufficient' until history accrues — that is the honest state,
 * not a bug.
 */

export interface IndexPricePoint {
  productId: string;
  /** Legacy text category from the products table (e.g. 'Laptops'). */
  category: string | null | undefined;
  /** Retailer country code (e.g. 'US', 'PK'); null → 'GLOBAL' pool only. */
  region: string | null | undefined;
  price: number;
  recordedAt: string;
}

export interface PriceIndexEntry {
  category: string;
  /** Region code, or 'GLOBAL' for all regions pooled. */
  region: string;
  /** UTC calendar month, YYYY-MM. */
  periodMonth: string;
  /** 100 × mean per-product ratio vs the base month; null when insufficient. */
  indexValue: number | null;
  /** Earliest month with recorded prices for this group. */
  baseMonth: string;
  /** Products with a ratio for this month. */
  productsUsed: number;
  /** Usable recorded price points for this group in this month. */
  pointsUsed: number;
  status: 'ok' | 'insufficient';
}

export interface PriceIndexGroupSummary {
  category: string;
  region: string;
  baseMonth: string;
  latestMonth: string | null;
  latestValue: number | null;
  /** Latest month vs the previous published month, %; null when unavailable. */
  latestChangePct: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  productsUsed: number;
  pointsUsed: number;
  status: 'ok' | 'insufficient';
}

export interface PriceIndexResult {
  entries: PriceIndexEntry[];
  summaries: PriceIndexGroupSummary[];
  /** Distinct categories present in the usable input. */
  categories: string[];
  /** Distinct regions present, always including 'GLOBAL'. */
  regions: string[];
  /** Earliest month with usable data, or null when there is none. */
  baseMonth: string | null;
  /** Days spanned by the usable input rows (0 when there are none). */
  historyDays: number;
  /** Usable recorded price points in total. */
  pointsUsed: number;
}

/** A published monthly index needs at least this many products. */
export const PRICE_INDEX_MIN_PRODUCTS = 2;
/** |month-over-month change| below this counts as flat (noise guard). */
export const PRICE_INDEX_FLAT_THRESHOLD_PCT = 0.1;

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

interface GroupedPoint {
  category: string;
  region: string;
  productId: string;
  month: string;
  price: number;
  ms: number;
}

/**
 * Monthly per-category/per-region index from recorded prices only.
 * `filter` narrows to one category and/or one region code
 * ('GLOBAL' means no region narrowing); unfiltered, every group
 * present in the data is reported, GLOBAL-pooled groups included.
 */
export function computePriceIndex(
  points: IndexPricePoint[],
  filter?: { category?: string | null; region?: string | null }
): PriceIndexResult {
  const usable: GroupedPoint[] = [];
  for (const p of points) {
    if (
      typeof p.category !== 'string' ||
      p.category.trim().length === 0 ||
      !Number.isFinite(p.price) ||
      p.price <= 0 ||
      !p.recordedAt ||
      !Number.isFinite(toMs(p.recordedAt))
    ) {
      continue;
    }
    const category = p.category.trim();
    const region =
      typeof p.region === 'string' && p.region.trim().length > 0
        ? p.region.trim().toUpperCase()
        : 'GLOBAL';
    if (filter?.category && category !== filter.category) continue;
    if (filter?.region && filter.region !== 'GLOBAL' && region !== filter.region) continue;
    usable.push({
      category,
      region,
      productId: p.productId,
      month: monthKey(toMs(p.recordedAt)),
      price: p.price,
      ms: toMs(p.recordedAt),
    });
  }

  const historyDays =
    usable.length === 0
      ? 0
      : Math.max(
          0,
          Math.ceil(
            (Math.max(...usable.map((p) => p.ms)) -
              Math.min(...usable.map((p) => p.ms))) /
              DAY_MS
          )
        );

  // Per-product monthly means, per group key category|region.
  // A product contributes to its region group AND to the GLOBAL
  // pooled group for its category (GLOBAL is a pool, not a place).
  const groupKeys = new Set<string>();
  const productMonthMean = new Map<string, { sum: number; count: number }>();
  const groupMonths = new Map<string, Set<string>>();
  const groupPoints = new Map<string, number>();
  for (const p of usable) {
    for (const region of [p.region, 'GLOBAL']) {
      const groupKey = `${p.category}|${region}`;
      groupKeys.add(groupKey);
      groupMonths.set(groupKey, (groupMonths.get(groupKey) ?? new Set()).add(p.month));
      groupPoints.set(groupKey, (groupPoints.get(groupKey) ?? 0) + 1);
      const pmKey = `${groupKey}|${p.productId}|${p.month}`;
      const acc = productMonthMean.get(pmKey) ?? { sum: 0, count: 0 };
      acc.sum += p.price;
      acc.count += 1;
      productMonthMean.set(pmKey, acc);
    }
  }

  const entries: PriceIndexEntry[] = [];
  for (const groupKey of [...groupKeys].sort()) {
    const [category, region] = groupKey.split('|');
    const months = [...(groupMonths.get(groupKey) ?? new Set())].sort();
    if (months.length === 0) continue;
    const baseMonth = months[0];
    // Products with a base-month mean for this group.
    const baseProducts = new Set<string>();
    for (const key of productMonthMean.keys()) {
      if (key.startsWith(`${groupKey}|`) && key.endsWith(`|${baseMonth}`)) {
        baseProducts.add(key.split('|')[2]);
      }
    }
    for (const month of months) {
      const ratios: number[] = [];
      let pointsUsed = 0;
      for (const productId of baseProducts) {
        const monthAcc = productMonthMean.get(`${groupKey}|${productId}|${month}`);
        const baseAcc = productMonthMean.get(`${groupKey}|${productId}|${baseMonth}`);
        if (!monthAcc || !baseAcc || baseAcc.sum === 0) continue;
        pointsUsed += monthAcc.count;
        ratios.push(monthAcc.sum / monthAcc.count / (baseAcc.sum / baseAcc.count));
      }
      const ok = ratios.length >= PRICE_INDEX_MIN_PRODUCTS;
      entries.push({
        category,
        region,
        periodMonth: month,
        indexValue: ok
          ? round1(
              (ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100
            )
          : null,
        baseMonth,
        productsUsed: ratios.length,
        pointsUsed,
        status: ok ? 'ok' : 'insufficient',
      });
    }
  }

  entries.sort((a, b) =>
    a.category === b.category
      ? a.region === b.region
        ? a.periodMonth.localeCompare(b.periodMonth)
        : a.region.localeCompare(b.region)
      : a.category.localeCompare(b.category)
  );

  const summaries: PriceIndexGroupSummary[] = [];
  const byGroup = new Map<string, PriceIndexEntry[]>();
  for (const e of entries) {
    const key = `${e.category}|${e.region}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), e]);
  }
  for (const [key, groupEntries] of [...byGroup.entries()].sort()) {
    const [category, region] = key.split('|');
    const published = groupEntries.filter((e) => e.status === 'ok');
    const latest = published[published.length - 1] ?? null;
    const previous = published[published.length - 2] ?? null;
    const latestChangePct =
      latest && previous && previous.indexValue !== 0
        ? round1(
            ((latest.indexValue! - previous.indexValue!) / previous.indexValue!) * 100
          )
        : null;
    const direction =
      latestChangePct === null
        ? 'unknown'
        : Math.abs(latestChangePct) < PRICE_INDEX_FLAT_THRESHOLD_PCT
          ? 'flat'
          : latestChangePct > 0
            ? 'up'
            : 'down';
    summaries.push({
      category,
      region,
      baseMonth: groupEntries[0].baseMonth,
      latestMonth: latest?.periodMonth ?? null,
      latestValue: latest?.indexValue ?? null,
      latestChangePct,
      direction,
      productsUsed: latest?.productsUsed ?? 0,
      pointsUsed: groupEntries.reduce((s, e) => s + e.pointsUsed, 0),
      status: latest ? 'ok' : 'insufficient',
    });
  }

  const categories = [...new Set(usable.map((p) => p.category))].sort();
  const regions = [
    'GLOBAL',
    ...[...new Set(usable.map((p) => p.region))].sort(),
  ].filter((r, i, arr) => arr.indexOf(r) === i);
  const allMonths = usable.map((p) => p.month).sort();

  return {
    entries,
    summaries,
    categories,
    regions,
    baseMonth: allMonths.length > 0 ? allMonths[0] : null,
    historyDays,
    pointsUsed: usable.length,
  };
}

/** Depth label for a group — shown wherever an index value appears. */
export function indexDepthLabel(entry: {
  productsUsed: number;
  pointsUsed: number;
}): string {
  return `based on ${entry.pointsUsed} recorded price${entry.pointsUsed === 1 ? '' : 's'} from ${entry.productsUsed} product${entry.productsUsed === 1 ? '' : 's'}`;
}
