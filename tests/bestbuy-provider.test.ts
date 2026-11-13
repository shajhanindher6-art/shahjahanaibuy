import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BestBuyProvider,
  BESTBUY_NOT_CONFIGURED_REASON,
  resetBestBuyThrottleForTests,
} from '@/services/providers/bestbuy-provider';
import {
  ProviderFetchError,
  ProviderNotConfiguredError,
} from '@/services/providers/errors';
import { getProviderDailyBudgetLimit } from '@/services/provider-budget';

// Final Real Data Completion — Best Buy Products API client.
// Mocked fetch only, never a live key: the key below is a fake
// test value ('bb-test-key-...'), never a real credential, and
// no test here touches the network.

const TEST_KEY = 'bb-test-key-000';

const PRODUCT = {
  sku: 6413523,
  name: 'Samsung Galaxy S24 Ultra 256GB (Unlocked) - Titanium Black',
  manufacturer: 'Samsung',
  modelNumber: 'SM-S928UZKAXAA',
  // GS1-valid UPC-A (check digit verified against lib/gtin.ts).
  upc: '036000291452',
  salePrice: 1199.99,
  regularPrice: 1299.99,
  priceUpdateDate: '2026-11-13T10:00:00.000-05:00',
  onlineAvailability: true,
  inStoreAvailability: true,
  orderable: true,
  description: 'A flagship phone.',
  shortDescription: 'Flagship phone.',
  image: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6413/6413523_sd.jpg',
  largeImage: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6413/6413523ld.jpg',
  url: 'https://www.bestbuy.com/site/samsung-galaxy-s24-ultra/6413523.p?skuId=6413523',
  details: [
    { name: 'Screen Size', value: '6.8 inches' },
    { name: 'Storage', value: '256GB' },
  ],
  categoryPath: [
    { id: 'pcmcat123', name: 'Cell Phones' },
    { id: 'pcmcat456', name: 'Unlocked Phones' },
  ],
  active: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setKey(): void {
  process.env.BESTBUY_API_KEY = TEST_KEY;
}

describe('BestBuyProvider — no key', () => {
  beforeEach(() => {
    delete process.env.BESTBUY_API_KEY;
    resetBestBuyThrottleForTests();
  });

  afterEach(() => {
    delete process.env.BESTBUY_API_KEY;
  });

  it('is unavailable with no key and explains why (never fake rows)', () => {
    const provider = new BestBuyProvider();
    expect(provider.isAvailable()).toBe(false);
    expect(provider.getNotConfiguredReason()).toBe(BESTBUY_NOT_CONFIGURED_REASON);
    expect(BESTBUY_NOT_CONFIGURED_REASON).toMatch(/no live price integration/);
  });

  it('search / fetch / UPC / model all throw NOT_CONFIGURED without a key', async () => {
    const provider = new BestBuyProvider();
    await expect(provider.search({ query: 'laptop' })).rejects.toBeInstanceOf(
      ProviderNotConfiguredError
    );
    await expect(
      provider.fetch({ externalId: '6413523', retailerSlug: 'bestbuy' })
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    await expect(provider.searchByUpc('036000291452')).rejects.toBeInstanceOf(
      ProviderNotConfiguredError
    );
    await expect(provider.searchByModel('SM-S928UZKAXAA')).rejects.toBeInstanceOf(
      ProviderNotConfiguredError
    );
  });

  it('a blank query is an empty result without spending a call', async () => {
    setKey();
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ products: [PRODUCT] }));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    expect(await provider.search({ query: '   ' })).toEqual([]);
    expect(await provider.searchByModel('  ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('BestBuyProvider — SKU fetch mapping', () => {
  beforeEach(() => {
    setKey();
    resetBestBuyThrottleForTests();
  });

  afterEach(() => {
    delete process.env.BESTBUY_API_KEY;
  });

  it('maps a full product: price / UPC / model / specs / images / availability', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse(PRODUCT));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    const result = await provider.fetch({ externalId: '6413523', retailerSlug: 'bestbuy' });

    expect(result).not.toBeNull();
    expect(result!.externalId).toBe('6413523');
    expect(result!.retailerSlug).toBe('bestbuy');
    expect(result!.name).toBe(PRODUCT.name);
    expect(result!.brand).toBe('Samsung');
    expect(result!.category).toBe('Unlocked Phones');
    expect(result!.gtin).toBe('036000291452');
    expect(result!.modelNumber).toBe('SM-S928UZKAXAA');
    expect(result!.price).toBe(1199.99);
    expect(result!.currency).toBe('USD');
    expect(result!.availability).toBe('in_stock');
    expect(result!.description).toBe('A flagship phone.');
    expect(result!.url).toBe(PRODUCT.url);
    expect(result!.images).toEqual([PRODUCT.image, PRODUCT.largeImage]);
    expect(result!.specs).toEqual([
      { key: 'Screen Size', value: '6.8 inches' },
      { key: 'Storage', value: '256GB' },
    ]);
    expect(result!.raw?.regularPrice).toBe(1299.99);
    expect(result!.raw?.priceUpdateDate).toBe('2026-11-13T10:00:00.000-05:00');

    // Fixed host + single-item path; the key travels in the query string.
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl.startsWith('https://api.bestbuy.com/v1/products/6413523.json')).toBe(true);
    expect(calledUrl).toContain(`apiKey=${TEST_KEY}`);
  });

  it('an invalid UPC is recorded as missing, never guessed', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...PRODUCT, upc: '12345' }));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    const result = await provider.fetch({ externalId: '6413523', retailerSlug: 'bestbuy' });
    expect(result!.gtin).toBeUndefined();
    expect(result!.name).toBe(PRODUCT.name);
  });

  it('a MAP-restricted sale price is never the recorded price (regular price instead)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ...PRODUCT, salePrice: 999.99, regularPrice: 1199.99, priceRestriction: 'MAP' })
    );
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    const result = await provider.fetch({ externalId: '6413523', retailerSlug: 'bestbuy' });
    expect(result!.price).toBe(1199.99);
    expect(result!.raw?.salePrice).toBe(999.99);
    expect(result!.raw?.priceRestriction).toBe('MAP');
  });

  it('a 404 and an inactive SKU are not-found (null), not an error', async () => {
    const notFoundMock = vi.fn(async () => new Response('not found', { status: 404 }));
    const provider = new BestBuyProvider({ fetchFn: notFoundMock as unknown as typeof fetch });
    expect(await provider.fetch({ externalId: '0000000', retailerSlug: 'bestbuy' })).toBeNull();

    const inactiveMock = vi.fn(async () => jsonResponse({ ...PRODUCT, active: false }));
    const inactiveProvider = new BestBuyProvider({
      fetchFn: inactiveMock as unknown as typeof fetch,
    });
    expect(
      await inactiveProvider.fetch({ externalId: '6413523', retailerSlug: 'bestbuy' })
    ).toBeNull();
  });

  it('search maps the list and skips rows with no displayable price', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({
        products: [PRODUCT, { ...PRODUCT, sku: 9999999, salePrice: null, regularPrice: null }],
      })
    );
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    const results = await provider.search({ query: 'samsung' });
    expect(results).toHaveLength(1);
    expect(results[0]?.externalId).toBe('6413523');
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl.startsWith('https://api.bestbuy.com/v1/products(search=samsung)')).toBe(true);
    expect(calledUrl).toContain('pageSize=10');
  });
});

describe('BestBuyProvider — UPC and model search', () => {
  beforeEach(() => {
    setKey();
    resetBestBuyThrottleForTests();
  });

  afterEach(() => {
    delete process.env.BESTBUY_API_KEY;
  });

  it('UPC search hits products(upc=...) and returns the exact match', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ products: [PRODUCT] }));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    const results = await provider.searchByUpc('036000291452');
    expect(results).toHaveLength(1);
    expect(results[0]?.externalId).toBe('6413523');
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('products(upc=036000291452)');
  });

  it('an invalid UPC never spends a call', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ products: [PRODUCT] }));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    expect(await provider.searchByUpc('not-a-gtin')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('model search hits products(modelNumber=...) as the no-UPC fallback', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonResponse({ products: [PRODUCT] }));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    const results = await provider.searchByModel('SM-S928UZKAXAA');
    expect(results).toHaveLength(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('products(modelNumber=SM-S928UZKAXAA)');
  });
});

describe('BestBuyProvider — failures', () => {
  beforeEach(() => {
    setKey();
    resetBestBuyThrottleForTests();
  });

  afterEach(() => {
    delete process.env.BESTBUY_API_KEY;
  });

  it('HTTP 403 (over-limit / bad key) and 500 become ProviderFetchError', async () => {
    const forbiddenMock = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const forbiddenProvider = new BestBuyProvider({
      fetchFn: forbiddenMock as unknown as typeof fetch,
    });
    await expect(forbiddenProvider.search({ query: 'laptop' })).rejects.toBeInstanceOf(
      ProviderFetchError
    );
    await expect(
      forbiddenProvider.fetch({ externalId: '6413523', retailerSlug: 'bestbuy' })
    ).rejects.toThrow(/HTTP 403/);

    const serverErrorMock = vi.fn(async () => new Response('boom', { status: 500 }));
    const serverErrorProvider = new BestBuyProvider({
      fetchFn: serverErrorMock as unknown as typeof fetch,
    });
    await expect(serverErrorProvider.search({ query: 'laptop' })).rejects.toThrow(/HTTP 500/);
  });

  it('malformed JSON and a throwing fetch become ProviderFetchError, never fake rows', async () => {
    const malformedMock = vi.fn(async () => new Response('not json {', { status: 200 }));
    const malformedProvider = new BestBuyProvider({
      fetchFn: malformedMock as unknown as typeof fetch,
    });
    await expect(malformedProvider.search({ query: 'laptop' })).rejects.toBeInstanceOf(
      ProviderFetchError
    );

    const throwingMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const throwingProvider = new BestBuyProvider({
      fetchFn: throwingMock as unknown as typeof fetch,
    });
    await expect(throwingProvider.search({ query: 'laptop' })).rejects.toBeInstanceOf(
      ProviderFetchError
    );
  });

  it('a search response with no products list is a fetch error, not an empty success', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ total: 0 }));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    await expect(provider.search({ query: 'laptop' })).rejects.toThrow(/no products list/);
  });
});

describe('BestBuyProvider — the key is never logged', () => {
  beforeEach(() => {
    resetBestBuyThrottleForTests();
  });

  afterEach(() => {
    delete process.env.BESTBUY_API_KEY;
  });

  it('a failing call logs the status but never the key or the full URL', async () => {
    const secretKey = 'bb-secret-KEY-98765';
    process.env.BESTBUY_API_KEY = secretKey;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const fetchMock = vi.fn(async (url: unknown) => {
        // The key IS sent (auth works) — it just must never reach a log.
        expect(String(url)).toContain(`apiKey=${secretKey}`);
        return new Response('forbidden', { status: 403 });
      });
      const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
      await expect(provider.search({ query: 'laptop' })).rejects.toThrow(/HTTP 403/);
      const logged = [
        ...warnSpy.mock.calls.map((c) => String(c[0])),
        ...errorSpy.mock.calls.map((c) => String(c[0])),
        ...infoSpy.mock.calls.map((c) => String(c[0])),
      ].join('\n');
      expect(logged).not.toContain(secretKey);
      expect(logged).not.toContain('api.bestbuy.com/v1/products');
      expect(logged).toContain('403');
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
    }
  });
});

describe('BestBuyProvider — 200ms throttle', () => {
  beforeEach(() => {
    setKey();
    resetBestBuyThrottleForTests();
  });

  afterEach(() => {
    delete process.env.BESTBUY_API_KEY;
  });

  it('two back-to-back calls are at least ~200ms apart (5 calls/second)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ products: [] }));
    const provider = new BestBuyProvider({ fetchFn: fetchMock as unknown as typeof fetch });
    const startedAt = Date.now();
    await provider.search({ query: 'first' });
    await provider.search({ query: 'second' });
    const elapsedMs = Date.now() - startedAt;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 200ms gap, with timer slack allowed — anything under ~180ms means the gate did not run.
    expect(elapsedMs).toBeGreaterThanOrEqual(180);
  });
});

describe('Best Buy daily budget (50,000/day)', () => {
  it('defaults to the documented 50,000/day, not the conservative 100', () => {
    expect(getProviderDailyBudgetLimit('bestbuy', { NODE_ENV: 'test' }).limit).toBe(50_000);
    expect(getProviderDailyBudgetLimit('bestbuy', { NODE_ENV: 'test' }).fromEnv).toBe(false);
    // Every other provider keeps the conservative default.
    expect(getProviderDailyBudgetLimit('csv', { NODE_ENV: 'test' }).limit).toBe(100);
    expect(getProviderDailyBudgetLimit('amazon', { NODE_ENV: 'test' }).limit).toBe(100);
  });

  it('an explicit env override still wins over the documented default', () => {
    expect(
      getProviderDailyBudgetLimit('bestbuy', { NODE_ENV: 'test', PROVIDER_DAILY_BUDGET_BESTBUY: '5' }).limit
    ).toBe(5);
    expect(
      getProviderDailyBudgetLimit('bestbuy', { NODE_ENV: 'test', PROVIDER_DAILY_BUDGET_BESTBUY: '5' }).fromEnv
    ).toBe(true);
  });
});
