/**
 * Price history data access service.
 * Reads from the `price_history` table (append-only time-series data).
 *
 * All functions accept an `AnySupabaseClient` so they work with both the
 * browser (anon, RLS-enforced) and server (service role) clients.
 *
 * Database snake_case columns are mapped to camelCase TypeScript properties.
 * Price values are parsed via `parseFloat()` to normalize numeric types.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { swrGet, cacheKey } from '@/lib/cache';
import { logger } from '@/lib/config/logger';
import type { PriceHistory } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceHistoryOptions {
  retailerId?: string;
  limit?: number;
}

export interface PriceHistoryResult {
  history: PriceHistory[];
  lowestPrice: number | null;
  highestPrice: number | null;
  currentPrice: number | null;
  previousPrice: number | null;
  priceChange: number | null;
}

// ---------------------------------------------------------------------------
// Row → domain mapper
// ---------------------------------------------------------------------------

interface PriceHistoryRow {
  id: string;
  product_id: string;
  retailer_id: string;
  price: number | string;
  currency: string;
  availability: string;
  url: string | null;
  recorded_at: string;
}

function mapPriceHistory(row: PriceHistoryRow): PriceHistory {
  return {
    id: row.id,
    productId: row.product_id,
    retailerId: row.retailer_id,
    price: parseFloat(String(row.price)),
    currency: row.currency,
    availability: row.availability,
    url: row.url,
    recordedAt: row.recorded_at,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch price history for a product with computed statistics.
 *
 * Returns `{ history, lowestPrice, highestPrice, currentPrice, previousPrice, priceChange }`.
 * - `currentPrice` is the most recent record's price.
 * - `previousPrice` is the second-most recent record's price.
 * - `priceChange` is `currentPrice - previousPrice`.
 *
 * @param options.retailerId Filter by a specific retailer.
 * @param options.limit     Maximum number of records to return (default 100).
 */
export async function getPriceHistory(
  supabase: AnySupabaseClient,
  productId: string,
  options: PriceHistoryOptions = {}
): Promise<PriceHistoryResult> {
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));

  try {
    let query = supabase
      .from('price_history')
      .select('id, product_id, retailer_id, price, currency, availability, url, recorded_at')
      .eq('product_id', productId)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (options.retailerId) {
      query = query.eq('retailer_id', options.retailerId);
    }

    const { data, error } = await query;

    if (error || !data) {
      if (error) logger.warn('getPriceHistory: query failed', { error: error.message });
      return {
        history: [],
        lowestPrice: null,
        highestPrice: null,
        currentPrice: null,
        previousPrice: null,
        priceChange: null,
      };
    }

    const history = data.map((row) => mapPriceHistory(row as PriceHistoryRow));

    if (history.length === 0) {
      return {
        history: [],
        lowestPrice: null,
        highestPrice: null,
        currentPrice: null,
        previousPrice: null,
        priceChange: null,
      };
    }

    const prices = history.map((h) => h.price);
    const lowestPrice = Math.min(...prices);
    const highestPrice = Math.max(...prices);
    const currentPrice = history[0].price;
    const previousPrice = history.length > 1 ? history[1].price : null;
    const priceChange = previousPrice !== null ? currentPrice - previousPrice : null;

    return {
      history,
      lowestPrice,
      highestPrice,
      currentPrice,
      previousPrice,
      priceChange,
    };
  } catch (err) {
    logger.error('getPriceHistory: unexpected error', { error: String(err) });
    return {
      history: [],
      lowestPrice: null,
      highestPrice: null,
      currentPrice: null,
      previousPrice: null,
      priceChange: null,
    };
  }
}

/**
 * Fetch price history with Stale-While-Revalidate caching.
 * Uses `swrGet` from `@/lib/cache` with `cacheKey('price-history', productId)`.
 */
export async function getCachedPriceHistory(
  supabase: AnySupabaseClient,
  productId: string,
  options: PriceHistoryOptions = {}
): Promise<PriceHistoryResult> {
  const key = cacheKey('price-history', productId, options.retailerId ?? 'all', options.limit ?? 100);
  return swrGet<PriceHistoryResult>(
    key,
    () => getPriceHistory(supabase, productId, options),
    60_000, // 1 min fresh
    300_000 // 5 min stale
  );
}

/**
 * Fetch the latest recorded price for each of several products in
 * ONE query (newest first, first row per product wins). Used by
 * search results, deal cards and the homepage widget so cards can
 * show a real price instead of no price at all. Products with no
 * price history are simply absent from the map — callers must
 * render "price not listed", never a guessed price.
 */
export async function getLatestPrices(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return prices;
  try {
    const { data, error } = await supabase
      .from('price_history')
      .select('product_id, price, recorded_at')
      .in('product_id', ids)
      .order('recorded_at', { ascending: false })
      .limit(500);
    if (error || !data) {
      if (error) logger.warn('getLatestPrices: query failed', { error: error.message });
      return prices;
    }
    for (const row of data as Array<{ product_id: string; price: number | string }>) {
      if (!prices.has(row.product_id)) {
        const price = parseFloat(String(row.price));
        if (Number.isFinite(price)) prices.set(row.product_id, price);
      }
    }
  } catch (err) {
    logger.error('getLatestPrices: unexpected error', { error: String(err) });
  }
  return prices;
}

/**
 * Fetch the latest price record for a product.
 * Returns `null` if no price history exists or on error.
 */
export async function getLatestPrice(
  supabase: AnySupabaseClient,
  productId: string
): Promise<PriceHistory | null> {
  try {
    const { data, error } = await supabase
      .from('price_history')
      .select('id, product_id, retailer_id, price, currency, availability, url, recorded_at')
      .eq('product_id', productId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      if (error) logger.warn('getLatestPrice: query failed', { error: error.message });
      return null;
    }

    return mapPriceHistory(data as PriceHistoryRow);
  } catch (err) {
    logger.error('getLatestPrice: unexpected error', { error: String(err) });
    return null;
  }
}
