/**
 * Cache layer with Stale-While-Revalidate (SWR) strategy.
 *
 * In-memory ONLY (Section 18, item 32 — corrected 12 Nov 2026):
 * there is no Redis mode here. An earlier header claimed this file
 * used `ioredis` when `REDIS_URL` is configured — that was false:
 * no `ioredis` import exists anywhere in the repo, the in-memory
 * `Map` below is always the store, and `REDIS_URL` is read only by
 * the Upstash REST rate limiter (lib/api/rate-limit.ts) and the
 * worker-queue fallback log line (lib/workers/queue.ts). `REDIS_URL`
 * being set changes NOTHING about this cache.
 *
 * Consequence: the cache is per-instance. On multi-instance Vercel
 * each instance holds its own `Map`; `invalidateCache()` clears
 * only the local instance, so other instances serve stale data
 * until their TTL expires (5 min stale by default, 1h for review
 * summaries). That staleness window is by design until a shared
 * cache exists — see the intake-approve invalidation comment in
 * app/api/v1/admin/intake/route.ts.
 *
 * Key helpers:
 * - `cacheKey(...parts)` — builds namespaced cache keys.
 * - `swrGet(...)` — serve fresh → stale → fetch-and-revalidate.
 */

import { logger } from '@/lib/config/logger';
import { isRedisRateLimitConfigured } from '@/lib/api/rate-limit';

// ---------------------------------------------------------------------------
// Cache key helper
// ---------------------------------------------------------------------------

/**
 * Build a colon-separated, namespaced cache key from parts.
 * Example: cacheKey('product', 'iphone-15') → 'smartbuy:product:iphone-15'
 */
export function cacheKey(...parts: (string | number)[]): string {
  return ['smartbuy', ...parts.map(String)].join(':');
}

// ---------------------------------------------------------------------------
// In-memory LRU cache (fallback when Redis is unavailable)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  freshUntil: number;
  staleUntil: number;
}

const DEFAULT_FRESH_TTL_MS = 60_000; // 1 minute fresh
const DEFAULT_STALE_TTL_MS = 300_000; // 5 minutes stale

/**
 * Section 21–25, Stage J, J-P2-8 — the TTL table, in one place.
 * Every `swrGet` call site below uses either the defaults or one
 * of these explicit pairs (verified by grep, 2026-11-13). Changing
 * a TTL is a behaviour change: update this table in the same edit
 * and say so in the commit — never change a TTL silently.
 *
 * All entries are per-instance in-memory (see the file header):
 * another Vercel instance keeps serving its own copy until its
 * TTL expires, so the "stale" column is also the cross-instance
 * staleness window.
 */
export interface CacheTtlEntry {
  /** Cache-key prefix (the `cacheKey(...)` first segment). */
  surface: string;
  /** Fresh TTL: served without a background refresh. */
  freshMs: number;
  /** Stale TTL: served stale + background refresh, then evicted. */
  staleMs: number;
  /** Where the TTL is set. */
  setIn: string;
}

export const CACHE_TTL_TABLE: readonly CacheTtlEntry[] = [
  { surface: 'product', freshMs: 60_000, staleMs: 300_000, setIn: 'services/products.ts (getCachedProductBySlug)' },
  { surface: 'merchant-products', freshMs: 60_000, staleMs: 300_000, setIn: 'services/commerce.ts (defaults — no explicit TTL)' },
  { surface: 'price-history', freshMs: 60_000, staleMs: 300_000, setIn: 'services/price-history.ts' },
  { surface: 'ai-search', freshMs: 30_000, staleMs: 120_000, setIn: 'services/ai-search.ts' },
  { surface: 'ai-summary', freshMs: 300_000, staleMs: 3_600_000, setIn: 'services/ai-summary.ts' },
  { surface: 'prediction', freshMs: 60_000, staleMs: 300_000, setIn: 'services/ai-predictions.ts' },
  { surface: 'comparison', freshMs: 60_000, staleMs: 300_000, setIn: 'services/ai-comparison.ts' },
  { surface: 'deals-ranked', freshMs: 60_000, staleMs: 300_000, setIn: 'services/ai-deals.ts' },
  { surface: 'review-summary', freshMs: 600_000, staleMs: 3_600_000, setIn: 'services/review-summary.ts (AI summary)' },
  { surface: 'review-summary-numbers', freshMs: 600_000, staleMs: 3_600_000, setIn: 'services/reviews.ts' },
];

export function getCacheTtl(surface: string): CacheTtlEntry | undefined {
  return CACHE_TTL_TABLE.find((entry) => entry.surface === surface);
}

/**
 * Section 21–25, Stage J, J-P2-8 — shared-cache readiness gate.
 * A shared cache needs the same Upstash Redis the rate limiter
 * uses. This returns true ONLY when Upstash is confirmed
 * configured (`UPSTASH_REDIS_REST_URL` + TOKEN set — see
 * `isRedisRateLimitConfigured`); until then the in-memory store
 * above stays the cache and its per-instance limitation (file
 * header) stands. No shared-cache read/write exists yet — this is
 * the gate the future Upstash-backed implementation must check
 * before activating, so the move cannot silently switch stores.
 */
export function isSharedCacheConfigured(): boolean {
  return isRedisRateLimitConfigured();
}

export function getSharedCacheStatus(): {
  configured: boolean;
  backend: 'upstash' | 'in-memory';
  limitation: string;
} {
  const configured = isSharedCacheConfigured();
  return {
    configured,
    backend: configured ? 'upstash' : 'in-memory',
    limitation: configured
      ? 'Upstash is configured, but no shared-cache implementation is wired yet — the in-memory store is still authoritative.'
      : 'Per-instance in-memory cache only: other Vercel instances serve stale copies until TTL expiry (see CACHE_TTL_TABLE).',
  };
}

const memoryStore = new Map<string, CacheEntry<unknown>>();

function memoryGet<T>(key: string): CacheEntry<T> | null {
  const entry = memoryStore.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  // Evict if past stale TTL
  if (Date.now() > entry.staleUntil) {
    memoryStore.delete(key);
    return null;
  }
  return entry;
}

function memorySet<T>(key: string, value: T, freshTtl: number, staleTtl: number): void {
  const now = Date.now();
  memoryStore.set(key, {
    value,
    freshUntil: now + freshTtl,
    staleUntil: now + staleTtl,
  });
}

// ---------------------------------------------------------------------------
// SWR get
// ---------------------------------------------------------------------------

/**
 * Stale-While-Revalidate get.
 *
 * - If the cached value is **fresh**, return it immediately.
 * - If the cached value is **stale** (past fresh TTL but within stale TTL),
 *   return the stale value and trigger a background refresh via `fetcher`.
 * - If no cached value exists, call `fetcher`, cache the result, and return it.
 *
 * @param key        Cache key (use `cacheKey()` to build it).
 * @param fetcher    Async function that fetches the fresh value.
 * @param freshTtlMs Fresh TTL in milliseconds (default 60s).
 * @param staleTtlMs Stale TTL in milliseconds (default 300s).
 */
export async function swrGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  freshTtlMs: number = DEFAULT_FRESH_TTL_MS,
  staleTtlMs: number = DEFAULT_STALE_TTL_MS
): Promise<T> {
  const cached = memoryGet<T>(key);

  if (cached) {
    const now = Date.now();

    // Fresh: serve synchronously
    if (now < cached.freshUntil) {
      return cached.value;
    }

    // Stale: serve stale and trigger background refresh (fire-and-forget)
    fetcher()
      .then((freshValue) => memorySet(key, freshValue, freshTtlMs, staleTtlMs))
      .catch((err) => logger.warn('SWR background refresh failed', { key, error: String(err) }));

    return cached.value;
  }

  // Cache miss: fetch, cache, and return
  const value = await fetcher();
  memorySet(key, value, freshTtlMs, staleTtlMs);
  return value;
}

/**
 * Invalidate cache entries matching a key prefix.
 * @param prefix The key prefix to invalidate (e.g. `cacheKey('product')`).
 */
export function invalidateCache(prefix: string): void {
  const keys = Array.from(memoryStore.keys());
  for (const key of keys) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Invalidate the AI-cache entries for one product (Section 19,
 * Phase 8, §12 #14 — the audit found `invalidateProductCaches`
 * cleared product/merchant/price-history/review-summary only, so
 * stale AI results could persist after the underlying data
 * changed).
 *
 * STRATEGY (documented, not silent):
 * - `ai-summary:<productId>` and `prediction:<productId>` are
 *   per-product keys — invalidated here, on the nose.
 * - `comparison:<sorted ids>` keys are multi-product: only the
 *   comparisons that actually contain this product are cleared
 *   (their key segments are scanned); other comparisons stay warm.
 * - `ai-search:<query...>` and `deals-ranked:<...>` are NOT
 *   product-keyed, so a per-product invalidation cannot target
 *   them. They are TTL-bounded instead (ai-search 30s fresh /
 *   120s stale; deals-ranked 60s / 300s), so the worst case is a
 *   ≤2 min / ≤5 min stale read. Wiping the whole query cache on
 *   every product refresh would thrash the cache the refresh just
 *   warmed — the short TTL is the chosen trade-off.
 * - This clears the IN-MEMORY entries only. The durable rows
 *   behind ai-summary/prediction (`ai_summaries` /
 *   `ai_predictions`, up to 7-day expiry) are cleared by
 *   `invalidateStoredAiResults` in
 *   `lib/cache/ai-invalidation.ts`, called from the refresh paths
 *   — clearing only the memory key would re-read the same stale
 *   row on the next request. Per-instance caveat (see the file
 *   header): other Vercel instances keep their copies until TTL
 *   expiry; a shared cache needs Upstash (owner-gated).
 */
export function invalidateAiCachesForProduct(productId: string): void {
  invalidateCache(cacheKey('ai-summary', productId));
  invalidateCache(cacheKey('prediction', productId));
  const comparisonPrefix = `${cacheKey('comparison')}:`;
  for (const key of Array.from(memoryStore.keys())) {
    if (!key.startsWith(comparisonPrefix)) continue;
    // Comparison keys are `smartbuy:comparison:<id>:<id>...`
    // (sorted ids joined with ':'); product ids are UUIDs, so a
    // segment match is exact, never a substring accident.
    const segments = key.slice(comparisonPrefix.length).split(':');
    if (segments.includes(productId)) memoryStore.delete(key);
  }
}

/**
 * Invalidate the cached entries for one product (Section 18,
 * item 33 — called on intake approve so a newly approved product
 * is visible immediately on THIS instance): the product row, its
 * merchant listings, its price history and its review summary.
 *
 * Section 19, Phase 8 (§12 #14): the AI entries for the product
 * (ai-summary, prediction, comparisons containing it) are
 * invalidated too — a product update that changes the price must
 * not leave a stale "good time to buy" summary behind.
 *
 * STALENESS WINDOW (by design, until a shared cache exists): the
 * cache is per-instance (see the file header), so this clears only
 * the local instance's `Map`. Other Vercel instances keep serving
 * their own cached copies until TTL expiry — up to 5 minutes stale
 * for product/price data, up to 1 hour for review summaries.
 */
export function invalidateProductCaches(productId: string, slug: string): void {
  invalidateCache(cacheKey('product', slug));
  invalidateCache(cacheKey('merchant-products', productId));
  invalidateCache(cacheKey('price-history', productId));
  invalidateCache(cacheKey('review-summary-numbers', productId));
  invalidateAiCachesForProduct(productId);
}

// In-memory only — see the file header. There is no Redis mode:
// no `ioredis` anywhere, and `REDIS_URL` is rate-limiting-only
// (lib/api/rate-limit.ts). Do not re-add a Redis claim here without
// wiring a real distributed store first.
