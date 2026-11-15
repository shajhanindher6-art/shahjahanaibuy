import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  EbayProvider,
  EBAY_NOT_CONFIGURED_REASON,
} from '@/services/providers/ebay-provider';
import { resetEbayTokenCacheForTests } from '@/services/ebay-browse';
import {
  ProviderFetchError,
  ProviderNotConfiguredError,
} from '@/services/providers/errors';

// Retailers Delta — eBay registry wrapper over services/ebay-browse.ts.
// Mocked fetch only, never a live key: the credentials below are
// fake test values, never real eBay credentials, and no test here
// touches the network.

const TOKEN_BODY = { access_token: 'ebay-test-token-000', expires_in: 7200 };

const LISTINGS = {
  itemSummaries: [
    {
      itemId: 'v1|1|0',
      title: 'Apple MacBook Air 13 M4 (2025) - 16GB RAM, 256GB SSD',
      price: { value: '899.00', currency: 'USD' },
      condition: 'NEW',
      itemWebUrl: 'https://www.ebay.com/itm/1',
      image: { imageUrl: 'https://i.ebayimg.com/test-macbook.jpg' },
      // GS1-valid GTIN-13 in the structured gtin field.
      gtin: '0195949215346',
    },
    {
      itemId: 'v1|2|0',
      title: 'Apple MacBook Air 13 M3 (2024) - 8GB RAM, 256GB SSD',
      // No parseable price: this row must be skipped, never guessed.
      price: { value: null, currency: 'USD' },
      condition: 'USED',
      itemWebUrl: 'https://www.ebay.com/itm/2',
      image: { imageUrl: 'https://i.ebayimg.com/test-macbook-2.jpg' },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Mock fetch serving the token endpoint, then the Browse search endpoint. */
function ebayFetch(searchStatus = 200, searchBody: unknown = LISTINGS, tokenStatus = 200) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('oauth2/token')) return jsonResponse(TOKEN_BODY, tokenStatus);
    if (url.includes('item_summary/search')) return jsonResponse(searchBody, searchStatus);
    return new Response('Not found', { status: 404 });
  });
}

function setCreds(): void {
  process.env.EBAY_CLIENT_ID = 'ebay-test-client-id';
  process.env.EBAY_CLIENT_SECRET = 'ebay-test-client-secret';
}

function clearCreds(): void {
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
}

describe('EbayProvider — no credentials', () => {
  beforeEach(() => {
    clearCreds();
    resetEbayTokenCacheForTests();
  });

  afterEach(() => {
    clearCreds();
  });

  it('is unavailable with no credentials and explains why (never fake listings)', () => {
    const provider = new EbayProvider();
    expect(provider.isAvailable()).toBe(false);
    expect(provider.getNotConfiguredReason()).toBe(EBAY_NOT_CONFIGURED_REASON);
    expect(EBAY_NOT_CONFIGURED_REASON).toMatch(/no live price integration/);
  });

  it('search / fetch throw NOT_CONFIGURED without credentials', async () => {
    const provider = new EbayProvider();
    await expect(provider.search({ query: 'macbook' })).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    await expect(provider.fetch({ externalId: 'v1|1|0', retailerSlug: 'ebay' })).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
  });
});

describe('EbayProvider — search (mocked fetch)', () => {
  beforeEach(() => {
    setCreds();
    resetEbayTokenCacheForTests();
  });

  afterEach(() => {
    clearCreds();
  });

  it('search delegates to Browse and maps listings to RawProductData', async () => {
    const fetchFn = ebayFetch();
    const provider = new EbayProvider({ fetchFn });
    const results = await provider.search({ query: 'MacBook Air 13' });

    // The priceless row is skipped; the priced row maps.
    expect(results).toHaveLength(1);
    const [product] = results;
    expect(product.externalId).toBe('v1|1|0');
    expect(product.retailerSlug).toBe('ebay');
    expect(product.name).toBe('Apple MacBook Air 13 M4 (2025) - 16GB RAM, 256GB SSD');
    expect(product.price).toBe(899);
    expect(product.currency).toBe('USD');
    // Browse search carries no stock field — unknown, never guessed.
    expect(product.availability).toBe('unknown');
    expect(product.gtin).toBe('0195949215346');
    expect(product.images).toEqual(['https://i.ebayimg.com/test-macbook.jpg']);
    expect(product.url).toBe('https://www.ebay.com/itm/1');
    expect(product.raw).toMatchObject({ itemId: 'v1|1|0', condition: 'NEW' });
    expect(fetchFn).toHaveBeenCalled();
  });

  it('blank query returns [] without calling eBay', async () => {
    const fetchFn = ebayFetch();
    const provider = new EbayProvider({ fetchFn });
    expect(await provider.search({ query: '   ' })).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a token failure becomes ProviderFetchError, not a fake listing', async () => {
    const fetchFn = ebayFetch(200, LISTINGS, 500);
    const provider = new EbayProvider({ fetchFn });
    await expect(provider.search({ query: 'macbook' })).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });

  it('a 429 from Browse becomes ProviderFetchError', async () => {
    const fetchFn = ebayFetch(429, {});
    const provider = new EbayProvider({ fetchFn });
    await expect(provider.search({ query: 'macbook' })).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });

  it('fetch returns null — single-item lookup is not in the underlying adapter', async () => {
    const fetchFn = ebayFetch();
    const provider = new EbayProvider({ fetchFn });
    const result = await provider.fetch({ externalId: 'v1|1|0', retailerSlug: 'ebay' });
    expect(result).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
