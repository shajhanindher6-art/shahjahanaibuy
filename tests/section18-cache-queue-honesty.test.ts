/**
 * Section 18, Phase 2 — cache honesty + queue honesty tests
 * (audit §1 #22/#28/#72, §12 items 32, 40, 43).
 *
 * - Item 32: the cache header falsely claimed a Redis mode
 *   (`ioredis` when REDIS_URL is set) and the provider registry
 *   reported Redis "enabled" on the same signal. Both are corrected:
 *   the cache is always in-memory; REDIS_URL is rate-limiting-only.
 * - Item 40: `image.process` reported `processed: urls.length`
 *   while doing nothing. It now reports `processed: 0`.
 * - Item 43: the BullMQ constructor logged the Redis URL (with
 *   credentials). It now logs only that a URL was configured.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fake Supabase client for the image.process empty-URL path (the
// processor reads product_images first). No network: the chain
// resolves zero rows, so the empty-URL early return is exercised.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }),
}));

import { PROVIDERS } from '@/lib/config/providers';
import { processors } from '@/lib/workers/processors';
import {
  swrGet,
  cacheKey,
  invalidateProductCaches,
} from '@/lib/cache';

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

describe('cache header correction (item 32)', () => {
  it('reports Redis as NOT enabled as a cache/queue provider', () => {
    const redis = PROVIDERS.find((p) => p.key === 'redis');
    expect(redis).toBeDefined();
    expect(redis?.enabled).toBe(false);
    expect(redis?.description).toMatch(/rate limiting/i);
    expect(redis?.description).toMatch(/in-memory/i);
  });

  it('does not claim a Redis/ioredis mode in lib/cache/index.ts', () => {
    const src = repoFile('lib', 'cache', 'index.ts');
    // The word `ioredis` still appears once, in the correction note
    // itself ("no `ioredis` import exists anywhere") — that is the
    // honest record, not a mode claim. What must be gone is the
    // claim that this cache USES ioredis / has a Redis mode.
    // The phrase "Redis mode" still appears once, in the correction
    // note itself ("there is no Redis mode here") — that is the
    // honest record, not a mode claim. What must be gone is the old
    // bold claim that this file HAS a Redis mode.
    expect(src).not.toContain('**Redis mode**');
    expect(src).toMatch(/no Redis mode/i);
    expect(src).toMatch(/In-memory ONLY/i);
    expect(src).toMatch(/per-instance/i);
  });

  it('does not report Redis enabled from REDIS_URL in providers.ts', () => {
    const src = repoFile('lib', 'config', 'providers.ts');
    expect(src).not.toContain('Boolean(process.env.REDIS_URL)');
  });
});

describe('image.process honest processed count (item 40)', () => {
  it('returns processed: 0 with placeholder:true when URLs are given', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const result = await processors['image.process']({
        type: 'image.process',
        data: {
          productId: 'p1',
          imageUrls: [
            'https://example.com/a.jpg',
            'https://example.com/b.jpg',
            'https://example.com/c.jpg',
          ],
        },
      });
      expect(result.success).toBe(true);
      // Three URLs in, zero processed — the processor is a
      // placeholder and must not claim the work happened.
      expect(result.processed).toBe(0);
      expect(result.metadata).toMatchObject({ placeholder: true, productId: 'p1' });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('still returns processed: 0 with no URLs at all', async () => {
    // No URLs → the processor reads product_images from the DB
    // first. The fake client returns zero rows (no network), so the
    // empty-URL early return is exercised, still with processed: 0.
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await processors['image.process']({
        type: 'image.process',
        data: { productId: 'p1', imageUrls: [] },
      });
      expect(result.processed).toBe(0);
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('intake approve invalidates the product cache keys (item 33)', () => {
  it('invalidateProductCaches clears the approved product only', async () => {
    let productFetches = 0;
    let otherFetches = 0;
    const productKey = cacheKey('product', 'new-slug');
    const otherKey = cacheKey('product', 'other-slug');
    await swrGet(productKey, async () => {
      productFetches++;
      return { id: 'p-new' };
    });
    await swrGet(otherKey, async () => {
      otherFetches++;
      return { id: 'p-other' };
    });
    // Second reads are cache hits — no refetch.
    await swrGet(productKey, async () => {
      productFetches++;
      return { id: 'p-new' };
    });
    expect(productFetches).toBe(1);

    invalidateProductCaches('p-new', 'new-slug');

    // The approved product refetches; the other product stays cached.
    await swrGet(productKey, async () => {
      productFetches++;
      return { id: 'p-new' };
    });
    await swrGet(otherKey, async () => {
      otherFetches++;
      return { id: 'p-other' };
    });
    expect(productFetches).toBe(2);
    expect(otherFetches).toBe(1);
  });

  it('clears merchant, price-history and review-summary keys too', async () => {
    let fetches = 0;
    const keys = [
      cacheKey('merchant-products', 'p-x'),
      cacheKey('price-history', 'p-x', 'all', 100),
      cacheKey('review-summary-numbers', 'p-x'),
    ];
    for (const key of keys) {
      await swrGet(key, async () => {
        fetches++;
        return { v: 1 };
      });
    }
    expect(fetches).toBe(3);
    invalidateProductCaches('p-x', 'slug-x');
    for (const key of keys) {
      await swrGet(key, async () => {
        fetches++;
        return { v: 1 };
      });
    }
    expect(fetches).toBe(6);
  });

  it('the intake approve path calls it (and documents the staleness window)', () => {
    const src = repoFile('app', 'api', 'v1', 'admin', 'intake', 'route.ts');
    expect(src).toContain('invalidateProductCaches(insertedIds[i], inserted[i])');
    const cacheSrc = repoFile('lib', 'cache', 'index.ts');
    expect(cacheSrc).toMatch(/STALENESS WINDOW/i);
    expect(cacheSrc).toMatch(/up to 5 minutes stale/);
  });
});

describe('BullMQ Redis URL is never logged (item 43)', () => {
  it('logs only that Redis was configured, never the URL value', () => {
    const src = repoFile('lib', 'workers', 'queue.ts');
    // The exact old log call must be gone. `{ url: redisUrl }`
    // still appears once — as the BullMQ *connection* object
    // (`{ connection: { url: redisUrl } }`), which is the intended
    // use of the value (handing it to BullMQ), not a log call.
    expect(src).not.toContain(
      "logger.info('BullMQ queue: initialized with Redis', { url: redisUrl })"
    );
    expect(src).toContain('redisConfigured: true');
    // No log call in the file carries the URL value.
    expect(src).not.toMatch(/logger\.\w+\([^)]*redisUrl[^)]*\)/);
  });
});
