/**
 * Section 19, Phase 8 (§12 #14) — AI cache invalidation tests.
 *
 * - After invalidation for a product, the cached AI result for
 *   that product is gone: the next read re-runs the fetcher (a
 *   fresh fetch occurs).
 * - Invalidation is targeted: other products' ai-summary /
 *   prediction entries, and comparisons NOT containing the product,
 *   stay warm.
 * - Comparisons containing the product ARE invalidated (the key is
 *   multi-product, so the segments are scanned).
 * - `invalidateProductCaches` (the intake-approve / product-update
 *   path) also clears the AI entries now.
 * - The stored rows behind the memory cache (`ai_summaries` /
 *   `ai_predictions`) are deleted by `invalidateStoredAiResults`,
 *   and a failing delete never throws (best-effort).
 */

import { describe, it, expect } from 'vitest';
import {
  swrGet,
  cacheKey,
  invalidateCache,
  invalidateAiCachesForProduct,
  invalidateProductCaches,
} from '@/lib/cache';
import {
  invalidateStoredAiResults,
  invalidateAiForProduct,
} from '@/lib/cache/ai-invalidation';

async function seedAiEntry(
  kind: 'ai-summary' | 'prediction',
  productId: string,
  fetcher: () => Promise<string>
): Promise<{ calls: () => number }> {
  let calls = 0;
  const countingFetcher = async () => {
    calls++;
    return fetcher();
  };
  await swrGet(cacheKey(kind, productId), countingFetcher);
  return { calls: () => calls };
}

describe('invalidateAiCachesForProduct (§12 #14)', () => {
  it('after invalidation the next AI read for the product fetches fresh', async () => {
    const seeded = await seedAiEntry('ai-summary', 'prod-1', async () => 'old summary');
    expect(seeded.calls()).toBe(1);
    // Warm read: still cached, no fresh fetch.
    await swrGet(cacheKey('ai-summary', 'prod-1'), async () => 'fresh summary');
    expect(seeded.calls()).toBe(1);

    invalidateAiCachesForProduct('prod-1');

    let freshCalls = 0;
    const fresh = await swrGet(cacheKey('ai-summary', 'prod-1'), async () => {
      freshCalls++;
      return 'fresh summary';
    });
    expect(fresh).toBe('fresh summary');
    expect(freshCalls).toBe(1);
  });

  it('invalidates the prediction entry for the same product', async () => {
    const seeded = await seedAiEntry('prediction', 'prod-9', async () => 'old prediction');
    expect(seeded.calls()).toBe(1);
    invalidateAiCachesForProduct('prod-9');
    let freshCalls = 0;
    await swrGet(cacheKey('prediction', 'prod-9'), async () => {
      freshCalls++;
      return 'fresh prediction';
    });
    expect(freshCalls).toBe(1);
  });

  it('leaves other products untouched', async () => {
    await seedAiEntry('ai-summary', 'prod-a', async () => 'summary a');
    await seedAiEntry('ai-summary', 'prod-b', async () => 'summary b');
    await seedAiEntry('prediction', 'prod-b', async () => 'prediction b');

    invalidateAiCachesForProduct('prod-a');

    let bSummaryCalls = 0;
    await swrGet(cacheKey('ai-summary', 'prod-b'), async () => {
      bSummaryCalls++;
      return 'summary b';
    });
    expect(bSummaryCalls).toBe(0);
    let bPredictionCalls = 0;
    await swrGet(cacheKey('prediction', 'prod-b'), async () => {
      bPredictionCalls++;
      return 'prediction b';
    });
    expect(bPredictionCalls).toBe(0);
  });

  it('invalidates only the comparisons that contain the product', async () => {
    const withProduct = cacheKey('comparison', ['prod-1', 'prod-2'].sort().join(':'));
    const withoutProduct = cacheKey('comparison', ['prod-3', 'prod-4'].sort().join(':'));
    let withCalls = 0;
    let withoutCalls = 0;
    await swrGet(withProduct, async () => {
      withCalls++;
      return 'comparison 1-2';
    });
    await swrGet(withoutProduct, async () => {
      withoutCalls++;
      return 'comparison 3-4';
    });
    expect(withCalls).toBe(1);
    expect(withoutCalls).toBe(1);

    invalidateAiCachesForProduct('prod-1');

    await swrGet(withProduct, async () => {
      withCalls++;
      return 'comparison 1-2 fresh';
    });
    expect(withCalls).toBe(2);
    await swrGet(withoutProduct, async () => {
      withoutCalls++;
      return 'comparison 3-4 fresh';
    });
    expect(withoutCalls).toBe(1);
  });

  it('invalidateProductCaches also clears the AI entries (product-update path)', async () => {
    const seeded = await seedAiEntry('ai-summary', 'prod-z', async () => 'old');
    expect(seeded.calls()).toBe(1);
    invalidateProductCaches('prod-z', 'slug-z');
    let freshCalls = 0;
    await swrGet(cacheKey('ai-summary', 'prod-z'), async () => {
      freshCalls++;
      return 'fresh';
    });
    expect(freshCalls).toBe(1);
  });

  it('invalidating a product with no cached entries is a no-op (does not throw)', () => {
    expect(() => invalidateAiCachesForProduct('prod-never-cached')).not.toThrow();
    expect(() => invalidateCache(cacheKey('ai-summary', 'prod-never-cached'))).not.toThrow();
  });
});

describe('invalidateStoredAiResults (§12 #14)', () => {
  function fakeClient(
    opts: { error?: { message: string } | null; throws?: boolean } = {}
  ): { client: unknown; deletes: Array<{ table: string; col: string; val: unknown }> } {
    const deletes: Array<{ table: string; col: string; val: unknown }> = [];
    const client = {
      from: (table: string) => ({
        delete: () => ({
          eq: (col: string, val: unknown) => {
            deletes.push({ table, col, val });
            if (opts.throws) throw new Error('transport failed');
            return Promise.resolve({ error: opts.error ?? null });
          },
        }),
      }),
    };
    return { client, deletes };
  }

  it('deletes the stored ai_summaries + ai_predictions rows for the product', async () => {
    const { client, deletes } = fakeClient();
    const result = await invalidateStoredAiResults(client as never, 'prod-1');
    expect(result).toEqual({ summariesCleared: true, predictionsCleared: true, errors: [] });
    expect(deletes).toEqual([
      { table: 'ai_summaries', col: 'product_id', val: 'prod-1' },
      { table: 'ai_predictions', col: 'product_id', val: 'prod-1' },
    ]);
  });

  it('a failing delete is reported, not thrown (best-effort)', async () => {
    const { client } = fakeClient({ error: { message: 'row-level security denied' } });
    const result = await invalidateStoredAiResults(client as never, 'prod-1');
    expect(result.summariesCleared).toBe(false);
    expect(result.predictionsCleared).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('a throwing client is reported, not thrown', async () => {
    const { client } = fakeClient({ throws: true });
    const result = await invalidateStoredAiResults(client as never, 'prod-1');
    expect(result.errors).toHaveLength(2);
  });

  it('invalidateAiForProduct clears memory AND stored rows together', async () => {
    const { client, deletes } = fakeClient();
    const seeded = await seedAiEntry('ai-summary', 'prod-7', async () => 'old');
    expect(seeded.calls()).toBe(1);
    const result = await invalidateAiForProduct(client as never, 'prod-7');
    expect(result.errors).toEqual([]);
    expect(deletes).toHaveLength(2);
    let freshCalls = 0;
    await swrGet(cacheKey('ai-summary', 'prod-7'), async () => {
      freshCalls++;
      return 'fresh';
    });
    expect(freshCalls).toBe(1);
  });
});
