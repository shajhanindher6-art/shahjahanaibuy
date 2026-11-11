/**
 * Price Protection Check — pure helpers for /tools/price-protection
 * (Section 14, Chunk 2). Guest tool, no sign-in.
 *
 * The user enters what they paid, when they bought it, and a
 * protection window (days). The check looks ONLY at the RECORDED
 * price history (currently 4 points per product over 30 days,
 * Amazon only) for recorded points inside that window after the
 * purchase date.
 *
 * What the check CAN prove: whether a lower price than the
 * purchase price was RECORDED inside the window after purchase,
 * and by how much. What it CANNOT prove: whether any retailer
 * will actually refund the difference — retailer price-protection
 * policies, claim deadlines, and exclusions are not in our data
 * and are never checked here. A 'lower-price-found' result is
 * evidence to take to the retailer, not a guarantee of a refund.
 *
 * Honesty rules: never smooth or interpolate; a window with no
 * recorded points is 'cannot-verify', never a pass; the purchase
 * date must not be in the future.
 */

import type { TrendPoint } from '@/lib/price-trend';

export type ProtectionVerdict =
  | 'lower-price-found'
  | 'no-lower-price'
  | 'cannot-verify';

export const PROTECTION_VERDICT_LABELS: Record<ProtectionVerdict, string> = {
  'lower-price-found':
    'Lower price recorded — you may have a protection claim',
  'no-lower-price':
    'No lower price recorded in the window',
  'cannot-verify': 'Cannot verify — not enough recorded history',
};

export const PROTECTION_WINDOWS_DAYS = [7, 14, 30, 60, 90] as const;
export type ProtectionWindowDays = (typeof PROTECTION_WINDOWS_DAYS)[number];

export interface ProtectionCheck {
  purchasePrice: number;
  purchaseDate: string;
  windowDays: number;
  /** Recorded points inside the window after the purchase date. */
  pointsInWindow: TrendPoint[];
  /** Lowest recorded price in the window, or null when none. */
  lowestAfterPurchase: number | null;
  /** purchasePrice minus lowestAfterPurchase; 0 when none found. */
  difference: number;
  verdict: ProtectionVerdict;
  /** Plain-language reason for a cannot-verify verdict. */
  reason: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Check a purchase against recorded points. `nowMs` is injectable
 * for tests. Returns null only for an invalid purchase price or an
 * unparseable purchase date; a future purchase date yields a
 * 'cannot-verify' result with a reason.
 */
export function checkPriceProtection(
  purchasePrice: number,
  purchaseDateISO: string,
  points: TrendPoint[],
  windowDays: number = 30,
  nowMs: number = Date.now()
): ProtectionCheck | null {
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return null;
  const purchaseMs = new Date(purchaseDateISO).getTime();
  if (!Number.isFinite(purchaseMs)) return null;

  const windowEndMs = purchaseMs + windowDays * DAY_MS;
  const inWindow = [...points]
    .filter(
      (p) =>
        Number.isFinite(p.price) &&
        p.recordedAt &&
        Number.isFinite(new Date(p.recordedAt).getTime())
    )
    .filter((p) => {
      const ms = new Date(p.recordedAt).getTime();
      return ms > purchaseMs && ms <= windowEndMs;
    })
    .sort(
      (a, b) =>
        new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );

  if (purchaseMs > nowMs) {
    return {
      purchasePrice,
      purchaseDate: purchaseDateISO,
      windowDays,
      pointsInWindow: inWindow,
      lowestAfterPurchase: null,
      difference: 0,
      verdict: 'cannot-verify',
      reason: 'The purchase date is in the future.',
    };
  }
  if (inWindow.length === 0) {
    return {
      purchasePrice,
      purchaseDate: purchaseDateISO,
      windowDays,
      pointsInWindow: [],
      lowestAfterPurchase: null,
      difference: 0,
      verdict: 'cannot-verify',
      reason:
        'No price was recorded in the window after your purchase date, so there is nothing to compare against.',
    };
  }
  const lowestAfterPurchase = Math.min(...inWindow.map((p) => p.price));
  if (lowestAfterPurchase < purchasePrice) {
    return {
      purchasePrice,
      purchaseDate: purchaseDateISO,
      windowDays,
      pointsInWindow: inWindow,
      lowestAfterPurchase,
      difference:
        Math.round((purchasePrice - lowestAfterPurchase) * 100) / 100,
      verdict: 'lower-price-found',
      reason: null,
    };
  }
  return {
    purchasePrice,
    purchaseDate: purchaseDateISO,
    windowDays,
    pointsInWindow: inWindow,
    lowestAfterPurchase,
    difference: 0,
    verdict: 'no-lower-price',
    reason: null,
  };
}

/** Parse the page's GET params: ?product=…&price=…&date=…&window=…. */
export function parseProtectionParams(searchParams: {
  product?: string | string[];
  price?: string | string[];
  date?: string | string[];
  window?: string | string[];
}): {
  productId: string | null;
  price: number | null;
  date: string | null;
  windowDays: ProtectionWindowDays;
  errors: string[];
  hasQuery: boolean;
} {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawProduct = first(searchParams.product);
  const rawPrice = first(searchParams.price);
  const rawDate = first(searchParams.date);
  const rawWindow = first(searchParams.window);

  const hasQuery =
    rawProduct !== undefined ||
    rawPrice !== undefined ||
    rawDate !== undefined ||
    rawWindow !== undefined;

  const errors: string[] = [];
  let price: number | null = null;
  if (rawPrice !== undefined && rawPrice.trim().length > 0) {
    const parsed = Number(rawPrice.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      errors.push(`"${rawPrice}" is not a valid purchase price — enter a positive number.`);
    } else {
      price = parsed;
    }
  } else if (hasQuery) {
    errors.push('Enter the price you paid.');
  }

  let date: string | null = null;
  if (rawDate !== undefined && rawDate.trim().length > 0) {
    const parsedMs = new Date(rawDate).getTime();
    if (!Number.isFinite(parsedMs) || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
      errors.push(`"${rawDate}" is not a valid purchase date — use YYYY-MM-DD.`);
    } else {
      date = rawDate.trim();
    }
  } else if (hasQuery) {
    errors.push('Enter the purchase date.');
  }

  const windowNum = rawWindow !== undefined ? Number(rawWindow) : 30;
  const windowDays: ProtectionWindowDays = (
    PROTECTION_WINDOWS_DAYS as readonly number[]
  ).includes(windowNum)
    ? (windowNum as ProtectionWindowDays)
    : 30;

  return {
    productId:
      rawProduct !== undefined && rawProduct.trim().length > 0
        ? rawProduct.trim()
        : null,
    price,
    date,
    windowDays,
    errors,
    hasQuery,
  };
}
