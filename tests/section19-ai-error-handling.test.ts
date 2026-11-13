/**
 * Section 19, Phase 9 (§12 #81) — AI error-handling tests.
 *
 * The AI services must fail safely: provider down / missing key /
 * malformed response / empty DB → an honest error or empty state,
 * never a crash, never invented output, and never a leaked secret
 * in the error.
 *
 * Coverage map for #81:
 *   - Engine fallback path — ALREADY COVERED by
 *     tests/section19-ai-engine.test.ts ("falls back to the next
 *     provider on failure and labels fallbackUsed:true",
 *     "throws when every provider fails", "skips a circuit-open
 *     provider"). Not duplicated here.
 *   - AI summary path — THIS FILE: getAISummary + getReviewAISummary
 *     with a throwing client and with a failing query both return
 *     null instead of throwing.
 *   - Provider path (SerpAPI) — THIS FILE: fetch rejects (provider
 *     down), malformed JSON, malformed shopping_results, and rows
 *     missing title/link/price all yield empty results, never a
 *     throw, and the outcome never contains the API key.
 *   - The other deterministic AI services — THIS FILE: getRankedDeals
 *     (empty result), compareProducts (null), predictPriceDrop
 *     (null) on a throwing client.
 *
 * The Supabase stubs are small chainable builders (thenable, with
 * eq / neq / in / is / gt / gte / or / order / limit / maybeSingle /
 * insert). Product ids are unique per test because the summary /
 * prediction services cache through swrGet (in-memory).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { env } from '@/lib/config/env';
import { getAISummary } from '@/services/ai-summary';
import { getReviewAISummary } from '@/services/review-summary';
import { getRankedDeals } from '@/services/ai-deals';
import { compareProducts } from '@/services/ai-comparison';
import { predictPriceDrop } from '@/services/ai-predictions';
import { searchWebProducts } from '@/services/external-search';
import { embedText, searchVisualByImageUrl } from '@/services/visual-search';
import { resetAiUsage } from '@/services/ai-engine/usage';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import type { Product } from '@/types';

type Row = Record<string, unknown>;

function setEnvKey(key: 'serpApiKey' | 'hfApiToken', value: string | undefined): void {
  (env as unknown as Record<string, string | undefined>)[key] = value;
}

/** Every Supabase call throws — the client itself is broken. */
function throwingClient(): AnySupabaseClient {
  return {
    from: () => {
      throw new Error('database down');
    },
  } as unknown as AnySupabaseClient;
}

/** Every Supabase call resolves with a DB error, never rows. */
function errorClient(): AnySupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    is: () => builder,
    gt: () => builder,
    gte: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve({ data: null, error: { message: 'database down' } }),
    insert: () => Promise.resolve({ data: null, error: { message: 'database down' } }),
    delete: () => builder,
    then(
      onFulfilled?: (value: { data: null; error: { message: string } }) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      return Promise.resolve({ data: null, error: { message: 'database down' } }).then(
        onFulfilled,
        onRejected
      );
    },
  };
  return { from: () => builder } as unknown as AnySupabaseClient;
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p19-err-summary',
    name: 'Test Widget',
    slug: 'test-widget',
    description: 'A test product.',
    brand: null,
    category: 'Gadgets',
    imageUrl: null,
    gtin: null,
    confidenceScore: 50,
    dataFreshness: '2026-11-02T00:00:00.000Z',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as Product;
}

describe('AI summary path — DB failure is an honest null, never a crash (#81)', () => {
  it('getAISummary: throwing client → null', async () => {
    const result = await getAISummary(throwingClient(), product({ id: 'p19-err-sum-throw' }));
    expect(result).toBeNull();
  });

  it('getAISummary: failing queries → honest empty-data summary, never a crash or invented output', async () => {
    // Deliberate asymmetry with getReviewAISummary (which returns
    // null): getAISummary's sub-readers treat a failed query as
    // "no data" (they read `{ data }` and default null to empty),
    // so a DB failure degrades to the honest "not enough data"
    // summary — an empty state, never a throw and never an
    // invented claim.
    const result = await getAISummary(errorClient(), product({ id: 'p19-err-sum-query' }));
    expect(result).not.toBeNull();
    expect(result!.pros).toContain(
      'Not enough data to assess quality — no reviews or specifications recorded for this product'
    );
    expect(result!.summary).not.toContain('reputable brand');
    expect(result!.summary).not.toContain('quality standards');
    expect(result!.cons).toContain(
      'No drawbacks identified in the available data — no reviews recorded for this product'
    );
  });

  it('getReviewAISummary: throwing client → null', async () => {
    const result = await getReviewAISummary(throwingClient(), 'p19-err-rs-throw');
    expect(result).toBeNull();
  });

  it('getReviewAISummary: failing queries → null', async () => {
    const result = await getReviewAISummary(errorClient(), 'p19-err-rs-query');
    expect(result).toBeNull();
  });
});

describe('Other deterministic AI services — DB failure is an empty state (#81)', () => {
  it('getRankedDeals: throwing client → empty result, never a throw', async () => {
    const result = await getRankedDeals(throwingClient());
    expect(result).toEqual({ deals: [], total: 0, categories: [] });
  });

  it('getRankedDeals: failing queries → empty result, never a throw', async () => {
    const result = await getRankedDeals(errorClient());
    expect(result).toEqual({ deals: [], total: 0, categories: [] });
  });

  it('compareProducts: throwing client → null, never a throw', async () => {
    const result = await compareProducts(throwingClient(), ['p19-err-cmp-a', 'p19-err-cmp-b']);
    expect(result).toBeNull();
  });

  it('compareProducts: failing queries → null, never a throw', async () => {
    const result = await compareProducts(errorClient(), ['p19-err-cmp-c', 'p19-err-cmp-d']);
    expect(result).toBeNull();
  });

  it('predictPriceDrop: throwing client → null, never a throw', async () => {
    const result = await predictPriceDrop(throwingClient(), 'p19-err-pred-throw');
    expect(result).toBeNull();
  });

  it('predictPriceDrop: failing queries → null, never a throw', async () => {
    const result = await predictPriceDrop(errorClient(), 'p19-err-pred-query');
    expect(result).toBeNull();
  });
});

describe('SerpAPI provider path — down / malformed / secret-safe (#81)', () => {
  const FAKE_KEY = 'test-serpapi-key-xyz';
  // The in-memory cache in external-search.ts is keyed by query —
  // a fresh query per test keeps the live-fetch path under test.
  let queryN = 0;
  const freshQuery = () => `error handling probe ${++queryN} ${Date.now()}`;

  beforeEach(() => {
    resetAiUsage();
    setEnvKey('serpApiKey', FAKE_KEY);
  });

  afterEach(() => {
    setEnvKey('serpApiKey', undefined);
    vi.restoreAllMocks();
  });

  function stubSupabase(): AnySupabaseClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      then(
        onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      },
    };
    return { from: () => builder } as unknown as AnySupabaseClient;
  }

  it('provider down (fetch rejects) → empty results, no throw, no key in the outcome', async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCalls++;
      throw new Error('fetch failed');
    });
    const outcome = await searchWebProducts(stubSupabase(), freshQuery());
    // withAiRetry retries transient failures (3 attempts), then the
    // service still answers with an honest empty outcome.
    expect(fetchCalls).toBe(3);
    expect(outcome.results).toEqual([]);
    expect(outcome.disabled).toBe(false);
    expect(outcome.budgetExhausted).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
  });

  it('malformed JSON response → empty results, no throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response);
    const outcome = await searchWebProducts(stubSupabase(), freshQuery());
    expect(outcome.results).toEqual([]);
    expect(outcome.fromCache).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
  });

  it('malformed shopping_results (not an array) → empty results, no throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ shopping_results: 'garbage, not an array' }),
    } as unknown as Response);
    const outcome = await searchWebProducts(stubSupabase(), freshQuery());
    expect(outcome.results).toEqual([]);
    expect(outcome.fromCache).toBe(false);
  });

  it('rows missing title/link are dropped; a garbage price becomes null, never invented', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        shopping_results: [
          { title: '', product_link: '' },
          {
            title: 'No Price Phone',
            product_link: 'https://example.com/no-price',
            extracted_price: 'free',
            price: 'not a price',
            source: 'Test Store',
          },
          {
            title: 'Priced Phone',
            product_link: 'https://example.com/priced',
            extracted_price: 199,
            source: 'Test Store',
          },
        ],
      }),
    } as unknown as Response);
    const outcome = await searchWebProducts(stubSupabase(), freshQuery());
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0].title).toBe('No Price Phone');
    expect(outcome.results[0].price).toBeNull();
    expect(outcome.results[1].title).toBe('Priced Phone');
    expect(outcome.results[1].price).toBe(199);
    expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
  });

  it('a 500 from SerpAPI → empty results, no throw, no key in the outcome', async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCalls++;
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    });
    const outcome = await searchWebProducts(stubSupabase(), freshQuery());
    expect(fetchCalls).toBe(3); // retried as a transient failure
    expect(outcome.results).toEqual([]);
    expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
  });
});

describe('Timeout paths — abort / timeout is retried, then fails honestly (#81)', () => {
  const FAKE_KEY = 'test-serpapi-key-xyz';
  // The in-memory caches in external-search.ts / visual-search.ts
  // are keyed by query / text / URL — a fresh value per test keeps
  // the live-fetch path under test.
  let queryN = 0;
  const freshQuery = () => `timeout probe ${++queryN} ${Date.now()}`;

  beforeEach(() => {
    resetAiUsage();
    setEnvKey('serpApiKey', FAKE_KEY);
    setEnvKey('hfApiToken', 'test-hf-token-xyz');
  });

  afterEach(() => {
    setEnvKey('serpApiKey', undefined);
    setEnvKey('hfApiToken', undefined);
    vi.restoreAllMocks();
  });

  function stubSupabase(): AnySupabaseClient {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      gt: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      then(
        onFulfilled?: (value: { data: Row[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
      },
    };
    return { from: () => builder } as unknown as AnySupabaseClient;
  }

  it('HF inference timeout (AbortError from the 30s AbortController) → retryable failure, never an invented embedding', async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCalls++;
      // Exactly what controller.abort() produces in hfFetch
      // (services/visual-search.ts) when HF_TIMEOUT_MS elapses.
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const result = await embedText(`timeout probe ${Date.now()} ${Math.random()}`);
    expect(fetchCalls).toBe(3); // AbortError is retryable, so withAiRetry retries
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('Hugging Face request failed');
    }
  });

  it('SerpAPI Lens timeout (AbortError from the 10s AbortController) → empty matches, no throw', async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCalls++;
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    // Literal public IP URL: the K2 SSRF guard runs before the
    // fetch, and example.com fails DNS in the sandbox (0 calls).
    const matches = await searchVisualByImageUrl(
      `https://8.8.8.8/timeout-probe-${Date.now()}.jpg`
    );
    expect(fetchCalls).toBe(3); // retried as a retryable (abort) failure
    expect(matches).toEqual([]);
  });

  it('SerpAPI timeout (AbortSignal.timeout → TimeoutError) → empty results, no throw, no key in the outcome', async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      fetchCalls++;
      // Exactly what AbortSignal.timeout(10000) produces in
      // searchWebProducts (services/external-search.ts).
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    const outcome = await searchWebProducts(stubSupabase(), freshQuery());
    expect(fetchCalls).toBe(3); // TimeoutError is retryable, so withAiRetry retries
    expect(outcome.results).toEqual([]);
    expect(outcome.disabled).toBe(false);
    expect(outcome.budgetExhausted).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
  });
});
