import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  WalmartProvider,
  WALMART_NOT_CONFIGURED_REASON,
  buildWalmartAuthHeaders,
  buildWalmartCanonicalString,
  resetWalmartThrottleForTests,
} from '@/services/providers/walmart-provider';
import {
  ProviderFetchError,
  ProviderNotConfiguredError,
} from '@/services/providers/errors';

// Retailers Delta — Walmart Affiliate API v2 client.
// Mocked fetch only, never a live key: the credentials below are
// a test-generated RSA keypair + a fake Consumer ID, never real
// Walmart credentials, and no test here touches the network.

const TEST_CONSUMER_ID = 'walmart-test-consumer-000';

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ITEM = {
  itemId: 123456789,
  name: 'Samsung Galaxy S24 Ultra 256GB (Unlocked) - Titanium Black',
  // GS1-valid UPC-A (check digit verified against lib/gtin.ts).
  upc: '036000291452',
  salePrice: 1199.99,
  msrp: 1299.99,
  categoryPath: 'Electronics > Cell Phones > Unlocked Phones',
  longDescription: 'A flagship phone.',
  thumbnailImage: 'https://i5.walmartimages.com/seo/test-image.jpg',
  productUrl: 'https://www.walmart.com/ip/test-item/123456789',
  availableOnline: true,
  addToCartUrl: 'https://www.walmart.com/cart/add?item=123456789',
  customerRating: 4.6,
  numReviews: 128,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setCreds(): void {
  process.env.WALMART_CONSUMER_ID = TEST_CONSUMER_ID;
  process.env.WALMART_PRIVATE_KEY = TEST_PRIVATE_KEY;
}

function clearCreds(): void {
  delete process.env.WALMART_CONSUMER_ID;
  delete process.env.WALMART_PRIVATE_KEY;
  delete process.env.WALMART_KEY_VERSION;
}

describe('WalmartProvider — signing', () => {
  it('builds the four auth headers with a verifiable RSA-SHA256 signature', () => {
    const nowMs = 1794000000000;
    const headers = buildWalmartAuthHeaders(TEST_CONSUMER_ID, TEST_PRIVATE_KEY, '1', nowMs);
    expect(headers['WM_CONSUMER.ID']).toBe(TEST_CONSUMER_ID);
    expect(headers['WM_CONSUMER.INTIMESTAMP']).toBe(String(nowMs));
    expect(headers['WM_SEC.KEY_VERSION']).toBe('1');
    expect(typeof headers['WM_SEC.AUTH_SIGNATURE']).toBe('string');
    expect(headers['WM_SEC.AUTH_SIGNATURE'].length).toBeGreaterThan(0);

    // The signature verifies against the public key over the
    // canonical string — the signing path works without a live call.
    const canonical = buildWalmartCanonicalString(TEST_CONSUMER_ID, nowMs, '1');
    const valid = cryptoVerify(
      'sha256',
      Buffer.from(canonical, 'utf8'),
      TEST_PUBLIC_KEY,
      Buffer.from(headers['WM_SEC.AUTH_SIGNATURE'], 'base64'),
    );
    expect(valid).toBe(true);
  });

  it('canonical string is the sorted header values, each followed by a newline', () => {
    expect(buildWalmartCanonicalString('cid-1', 1000, '1')).toBe('cid-1\n1000\n1\n');
  });

  it('accepts a PEM stored with literal \\n sequences (Vercel env style)', () => {
    const escaped = TEST_PRIVATE_KEY.replace(/\n/g, '\\n');
    const headers = buildWalmartAuthHeaders(TEST_CONSUMER_ID, escaped, '1', 1794000000000);
    expect(headers['WM_SEC.AUTH_SIGNATURE'].length).toBeGreaterThan(0);
  });

  it('a malformed private key throws NOT_CONFIGURED, never a fetch error', () => {
    expect(() => buildWalmartAuthHeaders(TEST_CONSUMER_ID, 'not-a-pem-key')).toThrow(
      ProviderNotConfiguredError,
    );
  });
});

describe('WalmartProvider — no credentials', () => {
  beforeEach(() => {
    clearCreds();
    resetWalmartThrottleForTests();
  });

  afterEach(() => {
    clearCreds();
  });

  it('is unavailable with no credentials and explains why (never fake rows)', () => {
    const provider = new WalmartProvider();
    expect(provider.isAvailable()).toBe(false);
    expect(provider.getNotConfiguredReason()).toBe(WALMART_NOT_CONFIGURED_REASON);
    expect(WALMART_NOT_CONFIGURED_REASON).toMatch(/no live price integration/);
    expect(WALMART_NOT_CONFIGURED_REASON).toMatch(/WALMART_CONSUMER_ID/);
  });

  it('search / fetch throw NOT_CONFIGURED without credentials', async () => {
    const provider = new WalmartProvider();
    await expect(provider.search({ query: 'laptop' })).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    await expect(provider.fetch({ externalId: '123', retailerSlug: 'walmart' })).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
  });

  it('a Consumer ID alone (no private key) is still unavailable', () => {
    process.env.WALMART_CONSUMER_ID = TEST_CONSUMER_ID;
    const provider = new WalmartProvider();
    expect(provider.isAvailable()).toBe(false);
  });
});

describe('WalmartProvider — search / fetch (mocked fetch)', () => {
  beforeEach(() => {
    setCreds();
    resetWalmartThrottleForTests();
  });

  afterEach(() => {
    clearCreds();
  });

  it('search maps price, currency, availability, GTIN, image and URL', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return jsonResponse({ totalResults: 1, items: [ITEM] });
    });
    const provider = new WalmartProvider({ fetchFn });
    const results = await provider.search({ query: 'Galaxy S24 Ultra' });

    expect(results).toHaveLength(1);
    const [product] = results;
    expect(product.externalId).toBe('123456789');
    expect(product.retailerSlug).toBe('walmart');
    expect(product.name).toBe(ITEM.name);
    expect(product.price).toBe(1199.99);
    expect(product.currency).toBe('USD');
    expect(product.availability).toBe('in_stock');
    expect(product.gtin).toBe('036000291452');
    expect(product.images).toEqual(['https://i5.walmartimages.com/seo/test-image.jpg']);
    expect(product.url).toBe('https://www.walmart.com/ip/test-item/123456789');
    expect(product.brand).toBeUndefined();
    expect(product.raw).toMatchObject({ msrp: 1299.99, salePrice: 1199.99 });

    // Signed request: the four auth headers travel on the call,
    // and the search hits the affiliate /search endpoint.
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain('/api-proxy/service/affil/product/v2/search');
    expect(seen[0].url).toContain('query=Galaxy+S24+Ultra');
    expect(seen[0].headers['WM_CONSUMER.ID']).toBe(TEST_CONSUMER_ID);
    expect(seen[0].headers['WM_SEC.AUTH_SIGNATURE']).toBeTruthy();
  });

  it('salePrice falls back to msrp, and an invalid UPC is dropped (never guessed)', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        items: [
          { ...ITEM, itemId: 1, salePrice: null, upc: '036000291453' },
          { ...ITEM, itemId: 2, upc: 'not-a-gtin' },
        ],
      }),
    );
    const provider = new WalmartProvider({ fetchFn });
    const results = await provider.search({ query: 'phone' });
    expect(results).toHaveLength(2);
    expect(results[0].price).toBe(1299.99);
    expect(results[0].gtin).toBeUndefined();
    expect(results[1].gtin).toBeUndefined();
  });

  it('rows with no price or no name are skipped, never recorded', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        items: [
          { ...ITEM, itemId: 1, salePrice: null, msrp: null },
          { ...ITEM, itemId: 2, name: '   ' },
          { ...ITEM, itemId: 3 },
        ],
      }),
    );
    const provider = new WalmartProvider({ fetchFn });
    const results = await provider.search({ query: 'phone' });
    expect(results).toHaveLength(1);
    expect(results[0].externalId).toBe('3');
  });

  it('availableOnline false reads out of stock; absent reads unknown', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        items: [
          { ...ITEM, itemId: 1, availableOnline: false },
          { ...ITEM, itemId: 2, availableOnline: undefined },
        ],
      }),
    );
    const provider = new WalmartProvider({ fetchFn });
    const results = await provider.search({ query: 'phone' });
    expect(results[0].availability).toBe('out_of_stock');
    expect(results[1].availability).toBe('unknown');
  });

  it('blank query returns [] without calling Walmart', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ items: [ITEM] }));
    const provider = new WalmartProvider({ fetchFn });
    expect(await provider.search({ query: '   ' })).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('search clamps numItems to the API max of 25', async () => {
    const seen: string[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      return jsonResponse({ items: [] });
    });
    const provider = new WalmartProvider({ fetchFn });
    await provider.search({ query: 'phone', limit: 100 });
    expect(seen[0]).toContain('numItems=25');
  });

  it('fetch by itemId maps the item; a 404 is null, not an error', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/items/404')) return new Response('Not found', { status: 404 });
      return jsonResponse(ITEM);
    });
    const provider = new WalmartProvider({ fetchFn });
    const found = await provider.fetch({ externalId: '123456789', retailerSlug: 'walmart' });
    expect(found?.externalId).toBe('123456789');
    expect(found?.price).toBe(1199.99);
    const missing = await provider.fetch({ externalId: '404', retailerSlug: 'walmart' });
    expect(missing).toBeNull();
  });

  it('HTTP 500, non-JSON and oversize responses become ProviderFetchError', async () => {
    const provider = new WalmartProvider({
      fetchFn: vi.fn(async () => new Response('Server error', { status: 500 })),
    });
    await expect(provider.search({ query: 'phone' })).rejects.toBeInstanceOf(ProviderFetchError);

    const badJson = new WalmartProvider({
      fetchFn: vi.fn(async () => new Response('not json', { status: 200 })),
    });
    await expect(badJson.search({ query: 'phone' })).rejects.toBeInstanceOf(ProviderFetchError);

    const oversize = new WalmartProvider({
      fetchFn: vi.fn(async () => new Response('x'.repeat(5_000_001), { status: 200 })),
    });
    await expect(oversize.search({ query: 'phone' })).rejects.toBeInstanceOf(ProviderFetchError);
  });

  it('a malformed private key throws NOT_CONFIGURED at call time', async () => {
    process.env.WALMART_PRIVATE_KEY = 'not-a-pem-key';
    const fetchFn = vi.fn(async () => jsonResponse({ items: [] }));
    const provider = new WalmartProvider({ fetchFn });
    await expect(provider.search({ query: 'phone' })).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
