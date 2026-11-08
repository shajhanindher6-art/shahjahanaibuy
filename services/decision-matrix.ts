/**
 * Decision Matrix — Enterprise feature #7.
 *
 * Pure helpers that turn already-fetched comparison data into a
 * tabular matrix. Every cell derives from REAL data only:
 *   - lowest price → the product's retailer rows,
 *   - category/brand → the catalog product row,
 *   - best coupon → the real coupons table (validity-filtered by
 *     lib/deal-math.ts bestCoupon — never an expired coupon),
 *   - price change / lowest-in-window → recorded price_history rows.
 *
 * NO invented specs, NO invented ratings: a cell is null when its
 * data does not exist, and the component renders null as "—".
 * Nothing here fetches anything — the caller assembles the inputs
 * from the public API routes and passes them in.
 */

import { bestCoupon, couponValueLabel, type DealCoupon } from '@/lib/deal-math';

export interface MatrixRetailerInput {
  retailerName: string;
  price: number;
  rating: number | null;
  reviewCount: number | null;
  availability: string;
}

export interface PriceHistoryPoint {
  price: number;
  recordedAt: string;
}

export interface MatrixProductInput {
  productId: string;
  slug: string;
  name: string;
  brand: string | null;
  /** Null when the category is unknown / not loaded. */
  category: string | null;
  retailers: MatrixRetailerInput[];
  /** ALL currently-valid coupons (the caller fetches them once). */
  coupons: DealCoupon[];
  /** merchant id → merchant name, for matching coupons to retailers. */
  merchantNameById: Record<string, string>;
  priceHistory: PriceHistoryPoint[];
}

/** A matrix cell: text, a USD amount (rendered region-aware), or null ("—"). */
export type MatrixCell =
  | { kind: 'text'; text: string }
  | { kind: 'usd'; usd: number }
  | null;

export interface MatrixRow {
  key: string;
  label: string;
  cells: MatrixCell[];
  /** Highlighted cells (e.g. the cheapest price in the row). */
  highlight: boolean[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lowest recorded retailer price, or null when there are no listings. */
export function lowestPrice(retailers: MatrixRetailerInput[]): number | null {
  let min: number | null = null;
  for (const r of retailers) {
    if (!Number.isFinite(r.price) || r.price <= 0) continue;
    if (min === null || r.price < min) min = r.price;
  }
  return min;
}

/**
 * Best currently-valid coupon for a product: coupons whose merchant
 * matches one of the product's retailers (by name, case-insensitive),
 * ranked by lib/deal-math.ts bestCoupon. Null when none applies.
 */
export function bestCouponForProduct(
  retailerNames: string[],
  coupons: DealCoupon[],
  merchantNameById: Record<string, string>
): DealCoupon | null {
  const wanted = new Set(retailerNames.map((n) => n.trim().toLowerCase()));
  const applicable = coupons.filter((c) => {
    if (!c.merchantId) return false;
    const name = merchantNameById[c.merchantId];
    return name !== undefined && wanted.has(name.trim().toLowerCase());
  });
  return bestCoupon(applicable);
}

function pointsInWindow(
  points: PriceHistoryPoint[],
  windowDays: number,
  now: Date
): Array<{ price: number; time: number }> {
  const start = now.getTime() - windowDays * DAY_MS;
  return points
    .map((p) => ({ price: p.price, time: new Date(p.recordedAt).getTime() }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.time) && p.time >= start)
    .sort((a, b) => a.time - b.time);
}

/**
 * Price change across the trailing window, oldest → latest.
 * Null when fewer than 2 recorded points fall in the window.
 * changePct is rounded to 1 decimal (negative = price fell).
 */
export function priceChangeInWindow(
  points: PriceHistoryPoint[],
  windowDays = 30,
  now: Date = new Date()
): { changePct: number; from: number; to: number } | null {
  const inWindow = pointsInWindow(points, windowDays, now);
  if (inWindow.length < 2) return null;
  const from = inWindow[0].price;
  const to = inWindow[inWindow.length - 1].price;
  if (from <= 0) return null;
  return {
    changePct: Math.round(((to - from) / from) * 1000) / 10,
    from,
    to,
  };
}

/** Lowest recorded price inside the trailing window, or null. */
export function lowestInWindow(
  points: PriceHistoryPoint[],
  windowDays = 30,
  now: Date = new Date()
): number | null {
  const inWindow = pointsInWindow(points, windowDays, now);
  if (inWindow.length === 0) return null;
  return Math.min(...inWindow.map((p) => p.price));
}

function textCell(value: string | null | undefined): MatrixCell {
  return value === null || value === undefined || value === '' ? null : { kind: 'text', text: value };
}

function usdCell(value: number | null | undefined): MatrixCell {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : { kind: 'usd', usd: value };
}

/**
 * Build every matrix row for 2+ products. Rows are fixed; a row is
 * still emitted when every cell is null (the component renders "—"),
 * so the table shape never depends on which data happens to exist.
 */
export function buildMatrixRows(
  products: MatrixProductInput[],
  now: Date = new Date()
): MatrixRow[] {
  const lowestPrices = products.map((p) => lowestPrice(p.retailers));
  const overallMin =
    lowestPrices.filter((v): v is number => v !== null).length > 0
      ? Math.min(...lowestPrices.filter((v): v is number => v !== null))
      : null;

  const rows: MatrixRow[] = [];

  rows.push({
    key: 'lowest-price',
    label: 'Lowest price',
    cells: lowestPrices.map((v) => usdCell(v)),
    highlight: lowestPrices.map((v) => v !== null && overallMin !== null && v === overallMin),
  });

  rows.push({
    key: 'category',
    label: 'Category',
    cells: products.map((p) => textCell(p.category)),
    highlight: products.map(() => false),
  });

  rows.push({
    key: 'brand',
    label: 'Brand',
    cells: products.map((p) => textCell(p.brand)),
    highlight: products.map(() => false),
  });

  rows.push({
    key: 'best-coupon',
    label: 'Best coupon',
    cells: products.map((p) => {
      const coupon = bestCouponForProduct(
        p.retailers.map((r) => r.retailerName),
        p.coupons,
        p.merchantNameById
      );
      return coupon ? textCell(`${coupon.code} — ${couponValueLabel(coupon)}`) : null;
    }),
    highlight: products.map(() => false),
  });

  rows.push({
    key: 'price-change-30d',
    label: 'Price change (30 days)',
    cells: products.map((p) => {
      const change = priceChangeInWindow(p.priceHistory, 30, now);
      if (!change) return null;
      const sign = change.changePct > 0 ? '+' : '';
      return { kind: 'text', text: `${sign}${change.changePct.toFixed(1)}%` };
    }),
    highlight: products.map(() => false),
  });

  rows.push({
    key: 'lowest-30d',
    label: 'Lowest (30 days)',
    cells: products.map((p) => usdCell(lowestInWindow(p.priceHistory, 30, now))),
    highlight: products.map(() => false),
  });

  rows.push({
    key: 'rating',
    label: 'Rating',
    cells: products.map((p) => {
      const rating = p.retailers.find(
        (r) => r.rating !== null && r.rating !== undefined
      )?.rating;
      return rating !== null && rating !== undefined
        ? textCell(`${rating.toFixed(1)} ★`)
        : null;
    }),
    highlight: products.map(() => false),
  });

  rows.push({
    key: 'reviews',
    label: 'Reviews',
    cells: products.map((p) => {
      const count = p.retailers.find(
        (r) => r.reviewCount !== null && r.reviewCount !== undefined
      )?.reviewCount;
      return count !== null && count !== undefined ? textCell(String(count)) : null;
    }),
    highlight: products.map(() => false),
  });

  rows.push({
    key: 'availability',
    label: 'Availability',
    cells: products.map((p) => {
      if (p.retailers.length === 0) return null;
      return textCell(
        p.retailers.some((r) => r.availability === 'in_stock')
          ? 'In Stock'
          : 'Out of Stock'
      );
    }),
    highlight: products.map(() => false),
  });

  return rows;
}
