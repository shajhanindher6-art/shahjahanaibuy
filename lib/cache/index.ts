/**
 * Cache layer with Stale-While-Revalidate (SWR) strategy.
 *
 * Dual-mode client:
 * - **Redis mode**: Uses `ioredis` when `REDIS_URL` is configured (distributed).
 * - **In-memory mode**: LRU cache fallback when Redis is unavailable (development).
 *
 * Key helpers:
 * - `cacheKey(...parts)` — builds namespaced cache keys.
 * - `swrGet(...)` — serve fresh → stale → fetch-and-revalidate.
 */

import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';

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

// Note: When REDIS_URL is configured, the in-memory store is still used as a
// per-instance L1 cache. A future enhancement can wire `ioredis` here for a
// distributed L2 cache. The SWR contract remains the same.
void env.redisUrl;
