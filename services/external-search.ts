/**
 * External web search fallback — SerpAPI Google Shopping.
 *
 * Purpose: when a user's query finds NOTHING in our own Supabase
 * catalog, the search page should not dead-end at "No results found".
 * This service fetches live shopping results from the web instead.
 *
 * Design rules (do not weaken them without a new decision):
 *   - Catalog first, web second. This service is ONLY called when the
 *     catalog search returned 0 results. It never replaces, reorders
 *     or mixes into catalog results, and its results are always
 *     labelled "Web result" in the UI.
 *   - No invented data. SerpAPI's google_shopping engine returns
 *     structured fields (title, extracted_price, source, link,
 *     thumbnail). Only those fields are used. If a field is missing
 *     (no price, no thumbnail, no specs), it is shown as missing —
 *     never guessed. Full specs are NOT available from a shopping
 *     SERP, so web cards link out to the retailer for specs instead
 *     of pretending to have them.
 *   - Key-gated, never in git. SERPAPI_API_KEY is read from the
 *     server environment only (Netlify env vars). If it is unset,
 *     this service returns [] immediately — no fetch, no crash, and
 *     the search page falls back to the old catalog-only empty state
 *     with a note that web search is not configured yet.
 *   - Quota-saving cache. SerpAPI's free plan is small (~100–250
 *     searches/month, verify on serpapi.com/pricing), so results are
 *     cached: first in a per-instance in-memory map (24h), then in
 *     the `external_search_cache` table (7 days, see migration 016)
 *     when that table exists and RLS allows it. A cache read/write
 *     failure (table not yet migrated, RLS denied) is swallowed —
 *     the live API call still happens, the feature just costs quota.
 *   - No direct retailer scraping. Amazon etc. block bots with
 *     CAPTCHAs; SerpAPI handles that on its side. This service never
 *     fetches a retailer page directly.
 *   - Nothing is written to the main `products` table. Web results
 *     live only in the cache above. Promoting a web result into the
 *     catalog (with GTIN, retailer mapping, price history) is a
 *     separate "Track this product" flow, not done here, because
 *     auto-promotion would pollute Deal Score, compare and alerts
 *     with unverified web data.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { env } from '@/lib/config/env';
import type { WebSearchResult } from '@/types/ai';

export type { WebSearchResult };

export interface WebSearchOutcome {
  results: WebSearchResult[];
  /** True when the results came from cache (no SerpAPI quota spent). */
  fromCache: boolean;
  /** True when SERPAPI_API_KEY is not configured. */
  disabled: boolean;
}

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches migration 016
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000; // 24h per-instance memory cache

interface MemoryEntry {
  results: WebSearchResult[];
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryEntry>();

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cacheKeyFor(query: string, limit: number): string {
  return `${normalizeQuery(query)}|${limit}`;
}

function stableId(link: string): string {
  // Small deterministic hash of the link — enough to key React lists.
  let hash = 0;
  for (let i = 0; i < link.length; i++) {
    hash = (hash * 31 + link.charCodeAt(i)) | 0;
  }
  return `web-${Math.abs(hash).toString(36)}-${link.length}`;
}

function normalizeShoppingRow(row: Record<string, unknown>): WebSearchResult | null {
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  const link =
    typeof row.product_link === 'string' && row.product_link
      ? row.product_link
      : typeof row.link === 'string'
        ? row.link
        : '';
  if (!title || !link) return null;

  const extracted = typeof row.extracted_price === 'number' ? row.extracted_price : null;
  const price =
    extracted !== null && Number.isFinite(extracted)
      ? extracted
      : typeof row.price === 'string'
        ? (() => {
            const n = parseFloat(row.price.replace(/[^0-9.]/g, ''));
            return Number.isFinite(n) ? n : null;
          })()
        : null;

  return {
    id: stableId(link),
    title,
    price,
    // google_shopping with gl=us reports USD prices.
    currency: 'USD',
    source: typeof row.source === 'string' ? row.source : null,
    link,
    thumbnail: typeof row.thumbnail === 'string' ? row.thumbnail : null,
    rating: typeof row.rating === 'number' ? row.rating : null,
    reviews: typeof row.reviews === 'number' ? row.reviews : null,
  };
}

async function readDbCache(
  supabase: AnySupabaseClient,
  key: string
): Promise<WebSearchResult[] | null> {
  try {
    const { data, error } = await supabase
      .from('external_search_cache')
      .select('results, expires_at')
      .eq('query_key', key)
      .gt('expires_at', new Date().toISOString())
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const results = (data as Record<string, unknown>).results;
    return Array.isArray(results) ? (results as WebSearchResult[]) : null;
  } catch {
    // Table not migrated yet, or RLS denied — cache is optional.
    return null;
  }
}

async function writeDbCache(
  supabase: AnySupabaseClient,
  key: string,
  query: string,
  results: WebSearchResult[]
): Promise<void> {
  try {
    await supabase.from('external_search_cache').upsert(
      {
        query_key: key,
        query: query.trim(),
        normalized_query: normalizeQuery(query),
        results,
        source: 'serpapi_google_shopping',
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      },
      { onConflict: 'query_key' }
    );
  } catch {
    // Best effort only — a failed cache write must not fail the search.
  }
}

export async function searchWebProducts(
  supabase: AnySupabaseClient,
  query: string,
  limit = 10
): Promise<WebSearchOutcome> {
  const safeLimit = Math.min(20, Math.max(1, limit));
  const key = cacheKeyFor(query, safeLimit);

  // 1. In-memory cache (fastest, no quota, no DB round trip).
  const mem = memoryCache.get(key);
  if (mem && Date.now() < mem.expiresAt) {
    return { results: mem.results, fromCache: true, disabled: false };
  }

  // 2. Persistent DB cache (survives redeploys / new instances).
  const dbCached = await readDbCache(supabase, key);
  if (dbCached) {
    memoryCache.set(key, { results: dbCached, expiresAt: Date.now() + MEMORY_TTL_MS });
    return { results: dbCached, fromCache: true, disabled: false };
  }

  // 3. Live SerpAPI call — only if a key is configured.
  const apiKey = env.serpApiKey;
  if (!apiKey || apiKey.trim() === '') {
    logger.warn('searchWebProducts: SERPAPI_API_KEY not configured, web fallback disabled');
    return { results: [], fromCache: false, disabled: true };
  }

  try {
    const url = new URL(SERPAPI_ENDPOINT);
    url.searchParams.set('engine', 'google_shopping');
    url.searchParams.set('q', query.trim());
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', String(safeLimit));
    url.searchParams.set('gl', 'us');
    url.searchParams.set('hl', 'en');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      logger.warn('searchWebProducts: SerpAPI request failed', { status: res.status });
      return { results: [], fromCache: false, disabled: false };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const rows = Array.isArray(data.shopping_results) ? data.shopping_results : [];
    const seen = new Set<string>();
    const results: WebSearchResult[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const normalized = normalizeShoppingRow(row);
      if (normalized && !seen.has(normalized.link)) {
        seen.add(normalized.link);
        results.push(normalized);
      }
      if (results.length >= safeLimit) break;
    }

    memoryCache.set(key, { results, expiresAt: Date.now() + MEMORY_TTL_MS });
    if (results.length > 0) {
      await writeDbCache(supabase, key, query, results);
    }
    return { results, fromCache: false, disabled: false };
  } catch (err) {
    logger.warn('searchWebProducts: SerpAPI request error', { error: String(err) });
    return { results: [], fromCache: false, disabled: false };
  }
}
