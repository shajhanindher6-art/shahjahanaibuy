/**
 * FX rates — Option 11, Phase 1 (Cross-Border & Multi-Currency Engine).
 *
 * HONESTY RULES (do not weaken them):
 * - The free feed below (open.er-api.com, no key required) publishes
 *   DAILY rates, not tick-by-tick trading rates. The UI must therefore
 *   say "live daily rate" with the feed's update date — never
 *   "real-time" as if it were a trading terminal.
 * - When the feed is unreachable, slow, or returns garbage, this
 *   module falls back to the APPROXIMATE static rates from
 *   services/currency.ts and says so (source: 'static'). A converted
 *   price from static rates is always shown with "≈" by consumers.
 * - Rates here are units of currency per 1 USD (e.g. PKR ≈ 280),
 *   the inverse of USD_PER_UNIT in currency.ts. Keep the direction
 *   straight: local = usd * rate; usd = local / rate.
 * - No FX API key is introduced and no rate is ever presented as a
 *   retailer's price — FX only converts SmartBuy's own real USD
 *   merchant prices into other currencies.
 */

import { USD_PER_UNIT, type CurrencyCode } from './currency';

export type FxSource = 'live' | 'static';

export interface FxRateSet {
  base: 'USD';
  /** Units of each currency per 1 USD. Only supported codes are included. */
  rates: Partial<Record<CurrencyCode, number>>;
  source: FxSource;
  /** Feed update timestamp (live only), or null for static fallback. */
  fetchedAt: string | null;
  provider: string | null;
}

const LIVE_URL = 'https://open.er-api.com/v6/latest/USD';
const REVALIDATE_SECONDS = 43200; // 12 hours — the free feed updates daily.
const FETCH_TIMEOUT_MS = 8000;

/** Static fallback: invert USD_PER_UNIT into units-per-USD. */
export function staticRates(): Record<CurrencyCode, number> {
  const out = {} as Record<CurrencyCode, number>;
  for (const code of Object.keys(USD_PER_UNIT) as CurrencyCode[]) {
    const perUnit = USD_PER_UNIT[code];
    out[code] = perUnit > 0 ? 1 / perUnit : 1;
  }
  return out;
}

/**
 * Fetch daily FX rates (server-side only — never import this from a
 * client component; clients use /api/v1/fx-rates). Falls back to
 * static rates on any failure, so callers never crash on FX.
 */
export async function getFxRates(): Promise<FxRateSet> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(LIVE_URL, {
        signal: controller.signal,
        next: { revalidate: REVALIDATE_SECONDS },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`FX feed HTTP ${res.status}`);
    const json: unknown = await res.json();
    const obj = json as { result?: unknown; rates?: unknown; time_last_update_utc?: unknown } | null;
    if (!obj || obj.result !== 'success' || typeof obj.rates !== 'object' || obj.rates === null) {
      throw new Error('FX feed malformed');
    }
    const feed = obj.rates as Record<string, unknown>;
    const rates = staticRates();
    let found = 0;
    for (const code of Object.keys(rates) as CurrencyCode[]) {
      const value = feed[code];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        rates[code] = value;
        found++;
      }
    }
    if (found === 0) throw new Error('FX feed has no usable rates');
    return {
      base: 'USD',
      rates,
      source: 'live',
      fetchedAt:
        typeof obj.time_last_update_utc === 'string'
          ? obj.time_last_update_utc
          : new Date().toISOString(),
      provider: 'open.er-api.com',
    };
  } catch {
    return {
      base: 'USD',
      rates: staticRates(),
      source: 'static',
      fetchedAt: null,
      provider: null,
    };
  }
}

/** Convert a USD amount into `code` using a rate set (units per USD). */
export function convertUsdWithRates(
  usd: number,
  code: CurrencyCode,
  rates: Partial<Record<CurrencyCode, number>>
): number {
  const rate = rates[code];
  if (!rate || rate <= 0) return usd;
  return usd * rate;
}
