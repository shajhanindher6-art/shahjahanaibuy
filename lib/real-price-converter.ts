/**
 * Inflation-Adjusted (Real-Price) Converter — pure helpers for
 * /tools/real-price-converter (Section 16, E6 / item 24).
 *
 * Amount + category → what that amount is worth in today's
 * recorded prices, using the category inflation index
 * (services/category-inflation.ts, trailing 90-day window).
 *
 * The conversion is one multiplication: an amount from 90 days
 * ago, expressed in today's recorded prices, is
 * amount × (1 + avgChangePct / 100). A category whose index is
 * `insufficient` (fewer than 2 products with a valid change) has
 * NO conversion — the page renders an honest empty state instead
 * of a number. Nothing here forecasts: the index is recorded
 * history only.
 */

import type { CategoryInflationEntry } from '@/services/category-inflation';

export interface RealPriceConversion {
  category: string;
  /** Average per-product % change over the trailing 90 days. */
  avgChangePct: number;
  direction: 'up' | 'down' | 'flat';
  productsUsed: number;
  pointsUsed: number;
  windowDays: number;
  /** The entered amount, in USD. */
  amountUsd: number;
  /** amountUsd × (1 + avgChangePct / 100), to the cent. */
  adjustedUsd: number;
  /** adjustedUsd − amountUsd, to the cent (negative when prices fell). */
  differenceUsd: number;
}

/**
 * Convert an amount from 90 days ago into today's recorded
 * prices for a category. Returns null when the entry is
 * insufficient (avgChangePct null) — callers render the honest
 * empty state instead.
 */
export function convertRealPrice(
  amountUsd: number,
  entry: CategoryInflationEntry,
  windowDays: number
): RealPriceConversion | null {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  if (entry.status !== 'ok' || entry.avgChangePct === null) return null;
  const adjustedUsd = Math.round(amountUsd * (1 + entry.avgChangePct / 100) * 100) / 100;
  return {
    category: entry.category,
    avgChangePct: entry.avgChangePct,
    direction: entry.direction === 'unknown' ? 'flat' : entry.direction,
    productsUsed: entry.productsUsed,
    pointsUsed: entry.pointsUsed,
    windowDays,
    amountUsd: Math.round(amountUsd * 100) / 100,
    adjustedUsd,
    differenceUsd: Math.round((adjustedUsd - amountUsd) * 100) / 100,
  };
}

/** Plain-language reading of a conversion (direction-aware). */
export function describeRealPriceConversion(c: RealPriceConversion): string {
  if (c.avgChangePct === 0 || c.direction === 'flat') {
    return (
      `Recorded ${c.category} prices were flat over the trailing ${c.windowDays} days ` +
      `(average change ${c.avgChangePct}%), so $${c.amountUsd.toFixed(2)} then is still ` +
      `$${c.adjustedUsd.toFixed(2)} in today's recorded prices.`
    );
  }
  if (c.direction === 'up') {
    return (
      `Recorded ${c.category} prices rose ${c.avgChangePct}% on average over the trailing ` +
      `${c.windowDays} days, so $${c.amountUsd.toFixed(2)} from then buys what ` +
      `$${c.adjustedUsd.toFixed(2)} buys in today's recorded prices.`
    );
  }
  return (
    `Recorded ${c.category} prices fell ${Math.abs(c.avgChangePct)}% on average over the trailing ` +
    `${c.windowDays} days, so $${c.amountUsd.toFixed(2)} from then is worth ` +
    `$${c.adjustedUsd.toFixed(2)} in today's recorded prices.`
  );
}

/** Parse the page's GET params: ?amount=…&category=…. */
export function parseRealPriceParams(searchParams: {
  amount?: string | string[];
  category?: string | string[];
}): {
  amount: number | null;
  category: string | null;
  errors: string[];
  hasQuery: boolean;
} {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const rawAmount = first(searchParams.amount);
  const rawCategory = first(searchParams.category);
  const hasQuery = rawAmount !== undefined || rawCategory !== undefined;
  const errors: string[] = [];

  let amount: number | null = null;
  if (rawAmount !== undefined && rawAmount.trim().length > 0) {
    const parsed = Number(rawAmount.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) {
      errors.push(`"${rawAmount}" is not a valid amount — enter a number.`);
    } else {
      amount = parsed;
    }
  }
  if (hasQuery && amount !== null && amount <= 0) {
    errors.push('Enter an amount above $0.');
  }
  if (hasQuery && amount === null && (rawAmount === undefined || rawAmount.trim().length === 0)) {
    errors.push('Enter an amount in USD.');
  }

  const category =
    rawCategory !== undefined && rawCategory.trim().length > 0 ? rawCategory.trim() : null;
  if (hasQuery && category === null) {
    errors.push('Pick a category.');
  }

  return { amount, category, errors, hasQuery };
}
