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
import { getFreshnessStatus, STALE_PRICE_DAYS } from '@/lib/price-freshness';
import type { PriceHistory } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriceHistoryOptions {
  retailerId?: string;
  limit?: number;
}

export interface PriceHistoryFreshness {
  /** 'fresh' | 'stale' | 'unknown' for the latest recorded point. */
  status: 'fresh' | 'stale' | 'unknown';
  ageDays: number | null;
  lastRecordedAt: string | null;
  /** True when the latest point is older than STALE_PRICE_DAYS. */
  stale: boolean;
}

export interface PriceHistoryResult {
  history: PriceHistory[];
  lowestPrice: number | null;
  highestPrice: number | null;
  currentPrice: number | null;
  previousPrice: number | null;
  priceChange: number | null;
  /**
   * FINAL 100% (W3, F-P1-37) — staleness metadata for the series:
   * the latest point's freshness, so no consumer has to re-derive
   * age itself (most did not). Present even when history is empty
   * (status 'unknown').
   */
  freshness: PriceHistoryFreshness;
  /**
   * True when at least 2 points exist and the latest price equals
   * the previous one — the series has not moved. The live seed
   * reads priceChange $0.00 on all 10 products with no such signal.
   */
  noMovement: boolean;
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
  /** Migration 057 — absent on a pre-057 table (see the retry below). */
  source?: string | null;
  observed_at?: string | null;
  suspicious_change?: boolean | null;
  /**
   * FINAL 100% (W1, F-P1-15 / F-P1-30) — absent until the future
   * migration adds them (see the retry below).
   */
  verified?: boolean | null;
  currency_assumed?: boolean | null;
}

/**
 * FINAL 100% (W3, F-P1-37) — every returned row carries its
 * provenance and its own staleness: `source` (null = no source
 * was recorded, never guessed), `observedAt`, the 057 suspicious
 * flag, and `ageDays`/`isStale` computed from `recorded_at`
 * against STALE_PRICE_DAYS.
 */
function mapPriceHistory(row: PriceHistoryRow): PriceHistory {
  const { status: rowStatus, ageDays } = getFreshnessStatus(row.recorded_at);
  return {
    id: row.id,
    productId: row.product_id,
    retailerId: row.retailer_id,
    price: parseFloat(String(row.price)),
    currency: row.currency,
    availability: row.availability,
    url: row.url,
    recordedAt: row.recorded_at,
    source: row.source ?? null,
    observedAt: row.observed_at ?? null,
    suspicious: row.suspicious_change ?? null,
    // FINAL 100% (W1, F-P1-15 / F-P1-30) — per-row verification
    // flag + assumed-currency flag (null when the row predates
    // the columns; a null is "unknown", never "verified").
    verified: row.verified ?? null,
    currencyAssumed: row.currency_assumed ?? null,
    ageDays,
    isStale: rowStatus === 'stale',
  };
}

const HISTORY_COLUMNS_WITH_VERIFICATION =
  'id, product_id, retailer_id, price, currency, availability, url, recorded_at, source, observed_at, suspicious_change, verified, currency_assumed';
const HISTORY_COLUMNS_WITH_PROVENANCE =
  'id, product_id, retailer_id, price, currency, availability, url, recorded_at, source, observed_at, suspicious_change';
const HISTORY_COLUMNS_LEGACY =
  'id, product_id, retailer_id, price, currency, availability, url, recorded_at';

/** PostgREST/Postgres code for "column does not exist" (057 unapplied). */
function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

function emptyResult(): PriceHistoryResult {
  return {
    history: [],
    lowestPrice: null,
    highestPrice: null,
    currentPrice: null,
    previousPrice: null,
    priceChange: null,
    freshness: { status: 'unknown', ageDays: null, lastRecordedAt: null, stale: false },
    noMovement: false,
  };
}

function buildFreshness(history: PriceHistory[]): PriceHistoryFreshness {
  const latest = history.length > 0 ? history[0].recordedAt : null;
  const { status, ageDays } = getFreshnessStatus(latest);
  return { status, ageDays, lastRecordedAt: latest, stale: status === 'stale' };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch price history for a product with computed statistics.
 *
 * Returns `{ history, lowestPrice, highestPrice, currentPrice, previousPrice, priceChange,
 * freshness, noMovement }`.
 * - `currentPrice` is the most recent record's price.
 * - `previousPrice` is the second-most recent record's price.
 * - `priceChange` is `currentPrice - previousPrice`.
 * - `freshness` is the staleness metadata for the latest point
 *   (FINAL 100%, W3 F-P1-37); every row also carries its own
 *   `source`, `observedAt`, `suspicious`, `ageDays` and `isStale`.
 * - `noMovement` is true when the latest price equals the previous
 *   one (a flat series, e.g. the live seed's identical last two
 *   points) — priceChange $0.00 on its own says nothing.
 *
 * The select asks for the migration-057 provenance columns first
 * and retries without them on 42703 (057 unapplied live), so the
 * read never fails over an unapplied migration — rows then carry
 * `source: null`, honestly unattributed rather than guessed.
 * FINAL 100% (W1, F-P1-15 / F-P1-30) — the first select also asks
 * for the per-row `verified` / `currency_assumed` flags; a 42703
 * retries with the 057 columns only (provenance kept, flags
 * null), and a second 42703 retries with the legacy columns.
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
    const runQuery = async (columns: string) => {
      let query = supabase
        .from('price_history')
        .select(columns)
        .eq('product_id', productId)
        .order('recorded_at', { ascending: false })
        .limit(limit);
      if (options.retailerId) {
        query = query.eq('retailer_id', options.retailerId);
      }
      return query;
    };

    let { data, error } = await runQuery(HISTORY_COLUMNS_WITH_VERIFICATION);
    if (error && isUndefinedColumnError(error)) {
      ({ data, error } = await runQuery(HISTORY_COLUMNS_WITH_PROVENANCE));
    }
    if (error && isUndefinedColumnError(error)) {
      ({ data, error } = await runQuery(HISTORY_COLUMNS_LEGACY));
    }

    if (error || !data) {
      if (error) logger.warn('getPriceHistory: query failed', { error: error.message });
      return emptyResult();
    }

    // The select takes a `string` column list (tiered retry), so
    // supabase-js cannot infer the row shape and types `data` as
    // GenericStringError — cast through unknown, the same escape
    // hatch the rest of the tree uses for variable column lists.
    // The runtime shape is a price_history row; the mapper reads
    // each field defensively.
    const history = data.map((row) => mapPriceHistory(row as unknown as PriceHistoryRow));

    if (history.length === 0) {
      return emptyResult();
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
      freshness: buildFreshness(history),
      noMovement: priceChange !== null && priceChange === 0,
    };
  } catch (err) {
    logger.error('getPriceHistory: unexpected error', { error: String(err) });
    return emptyResult();
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
    const runQuery = async (columns: string) =>
      supabase
        .from('price_history')
        .select(columns)
        .eq('product_id', productId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    let { data, error } = await runQuery(HISTORY_COLUMNS_WITH_VERIFICATION);
    if (error && isUndefinedColumnError(error)) {
      ({ data, error } = await runQuery(HISTORY_COLUMNS_WITH_PROVENANCE));
    }
    if (error && isUndefinedColumnError(error)) {
      ({ data, error } = await runQuery(HISTORY_COLUMNS_LEGACY));
    }

    if (error || !data) {
      if (error) logger.warn('getLatestPrice: query failed', { error: error.message });
      return null;
    }

    // Same variable-column-list cast as getPriceHistory above:
    // supabase-js types `data` as GenericStringError here.
    return mapPriceHistory(data as unknown as PriceHistoryRow);
  } catch (err) {
    logger.error('getLatestPrice: unexpected error', { error: String(err) });
    return null;
  }
}
