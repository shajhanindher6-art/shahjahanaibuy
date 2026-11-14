/**
 * Currency Converter — pure helpers for /tools/currency-converter
 * (Section 13, Chunk B).
 *
 * Convert an arbitrary amount between any two of the 51 supported
 * currencies (e.g. $999 → PKR). The FX table already powers region
 * prices, but no page ever converted an amount — this is that page.
 *
 * Honesty rule: rates are the APPROXIMATE static table in
 * services/currency.ts (original block reviewed 2026-11-01,
 * worldwide-expansion block reviewed 2026-11-02) — never a live
 * feed. Every result is labelled "≈" with that review date, and
 * the converter never claims a live or real-time rate.
 */

import {
  USD_PER_UNIT,
  type CurrencyCode,
} from '@/services/currency';
import { formatPrice } from '@/lib/region';

/** All 51 supported codes, in table order (USD first). */
export const SUPPORTED_CURRENCIES: CurrencyCode[] = Object.keys(
  USD_PER_UNIT
) as CurrencyCode[];

export const RATES_NOTE =
  'Approximate static rates, reviewed 2026-11-01/02 — not live rates. Converted amounts are estimates; the rate at checkout may differ.';

/** True when the code is one of the 51 supported currencies. */
export function isCurrencyCode(value: string | null | undefined): value is CurrencyCode {
  return !!value && (SUPPORTED_CURRENCIES as string[]).includes(value.toUpperCase());
}

export interface ConversionResult {
  amount: number;
  from: CurrencyCode;
  to: CurrencyCode;
  /** Converted amount, rounded to 2 decimals (0 for zero-decimal display handled by the page). */
  converted: number;
  /** Units of `to` per 1 unit of `from`. */
  rate: number;
  /** USD value of the input amount, for the "≈ $X" cross-check line. */
  usdValue: number;
}

/**
 * Convert an amount from one supported currency to another via
 * USD. Returns null for a non-positive amount or an unknown code.
 * Same-currency conversion returns the amount unchanged.
 */
export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode
): ConversionResult | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) return null;
  const usdValue = amount * USD_PER_UNIT[from];
  const converted =
    to === from ? amount : usdValue / USD_PER_UNIT[to];
  const rate =
    to === from ? 1 : USD_PER_UNIT[from] / USD_PER_UNIT[to];
  return {
    amount,
    from,
    to,
    converted: Math.round(converted * 100) / 100,
    rate: Math.round(rate * 1000000) / 1000000,
    usdValue: Math.round(usdValue * 100) / 100,
  };
}

/** Format an amount in a currency with grouping (2 decimals). Stage 2, S2-2: delegates to the canonical formatPrice in lib/region.ts. */
export function formatConvertedAmount(amount: number, code: CurrencyCode): string {
  return formatPrice(amount, code, 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Parse the page's GET params: ?amount=…&from=…&to=…. */
export function parseConverterParams(searchParams: {
  amount?: string | string[];
  from?: string | string[];
  to?: string | string[];
}): {
  amount: number | null;
  from: CurrencyCode;
  to: CurrencyCode;
  amountError: string | null;
} {
  const rawAmount = Array.isArray(searchParams.amount)
    ? searchParams.amount[0]
    : searchParams.amount;
  const rawFrom = Array.isArray(searchParams.from)
    ? searchParams.from[0]
    : searchParams.from;
  const rawTo = Array.isArray(searchParams.to)
    ? searchParams.to[0]
    : searchParams.to;

  let amount: number | null = null;
  let amountError: string | null = null;
  if (rawAmount !== undefined && rawAmount.trim().length > 0) {
    const parsed = Number(rawAmount.replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      amountError = `"${rawAmount}" is not a valid amount — enter a positive number.`;
    } else {
      amount = parsed;
    }
  }

  return {
    amount,
    from: isCurrencyCode(rawFrom) ? (rawFrom.toUpperCase() as CurrencyCode) : 'USD',
    to: isCurrencyCode(rawTo) ? (rawTo.toUpperCase() as CurrencyCode) : 'PKR',
    amountError,
  };
}
