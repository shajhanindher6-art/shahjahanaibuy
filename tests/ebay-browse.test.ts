import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  isEbayConfigured,
  resetEbayTokenCacheForTests,
  searchEbayListings,
} from '@/services/ebay-browse';

// Section 8 — eBay Browse API adapter. Env-gated and off by
// default: without credentials no network call is ever made and
// the result is an honest 'not-configured', never a fake listing.

const CLIENT_ID = 'EBAY_CLIENT_ID';
const CLIENT_SECRET = 'EBAY_CLIENT_SECRET';
const MARKETPLACE = 'EBAY_MARKETPLACE_ID';

const saved: Record<string, string | undefined> = {
  [CLIENT_ID]: process.env[CLIENT_ID],
  [CLIENT_SECRET]: process.env[CLIENT_SECRET],
  [MARKETPLACE]: process.env[MARKETPLACE],
};

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function jsonResponse(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  resetEbayTokenCacheForTests();
});

afterEach(() => setEnv(saved));

describe('isEbayConfigured', () => {
  it('is false when either credential is missing', () => {
    setEnv({ [CLIENT_ID]: 'id-only', [CLIENT_SECRET]: undefined });
    expect(isEbayConfigured()).toBe(false);
    setEnv({ [CLIENT_ID]: undefined, [CLIENT_SECRET]: undefined });
    expect(isEbayConfigured()).toBe(false);
  });

  it('is true when both credentials are set', () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    expect(isEbayConfigured()).toBe(true);
  });
});

describe('searchEbayListings', () => {
  it('returns not-configured without calling fetch when no credentials exist', async () => {
    setEnv({ [CLIENT_ID]: undefined, [CLIENT_SECRET]: undefined });
    const fetchFn = vi.fn(async () => {
      throw new Error('fetch must not be called when unconfigured');
    });
    const result = await searchEbayListings('macbook air', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'not-configured', listings: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects empty and over-long queries without calling fetch', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const fetchFn = vi.fn(async () => {
      throw new Error('fetch must not be called for an invalid query');
    });
    const fetchArg = fetchFn as unknown as typeof fetch;
    expect(await searchEbayListings('   ', { fetchFn: fetchArg })).toEqual({
      ok: false,
      reason: 'invalid-query',
      listings: [],
    });
    expect(await searchEbayListings('x'.repeat(201), { fetchFn: fetchArg })).toEqual({
      ok: false,
      reason: 'invalid-query',
      listings: [],
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches a token once, then searches cheapest-first and parses listings', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const calls: Array<{ url: string; init?: unknown }> = [];
    const fetchFn = vi.fn(async (url: string, init?: unknown) => {
      calls.push({ url, init });
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(true, {
        itemSummaries: [
          {
            itemId: '1',
            title: 'MacBook Air 13',
            price: { value: '999.00', currency: 'USD' },
            condition: 'New',
            itemWebUrl: 'https://www.ebay.com/itm/1',
            image: { imageUrl: 'https://i.ebayimg.com/1.jpg' },
          },
          {
            itemId: '2',
            title: 'MacBook Air 13 used',
            price: { value: '750', currency: 'USD' },
            condition: 'Used',
            itemWebUrl: 'https://www.ebay.com/itm/2',
          },
          // Invalid row (no link) — dropped, never rendered.
          { itemId: '3', title: 'No link here', price: { value: '1', currency: 'USD' } },
        ],
      });
    });
    const result = await searchEbayListings('macbook air', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('ebay-browse-api');
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]).toEqual({
      itemId: '1',
      title: 'MacBook Air 13',
      price: 999,
      currency: 'USD',
      condition: 'New',
      itemWebUrl: 'https://www.ebay.com/itm/1',
      imageUrl: 'https://i.ebayimg.com/1.jpg',
    });
    expect(result.listings[1].imageUrl).toBeNull();
    // Token fetched once (cached), search called once, cheapest-first.
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('oauth2/token');
    expect(calls[1].url).toContain('item_summary/search');
    expect(calls[1].url).toContain('sort=price');
    expect(calls[1].url).toContain('limit=5');
    const searchInit = calls[1].init as { headers: Record<string, string> };
    expect(searchInit.headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_US');
  });

  it('clamps the limit to 10', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(true, { itemSummaries: [] });
    });
    const result = await searchEbayListings('phone', {
      limit: 99,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true, source: 'ebay-browse-api', listings: [] });
    expect(urls[1]).toContain('limit=10');
  });

  it('returns api-error when the token request fails', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const fetchFn = vi.fn(async () => jsonResponse(false, { error: 'invalid_client' }));
    const result = await searchEbayListings('phone', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'api-error', listings: [] });
  });

  it('returns api-error when the search request fails', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(false, { errors: [{ message: 'boom' }] });
    });
    const result = await searchEbayListings('phone', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'api-error', listings: [] });
  });

  // Section 15, P3-6 — new adapter cases.
  it('refetches the token when the cached token is expired', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    let tokenCalls = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2/token')) {
        tokenCalls += 1;
        // expires_in 30s minus the 60s early-refresh margin means
        // the token is already expired when cached.
        return jsonResponse(true, { access_token: `tok-${tokenCalls}`, expires_in: 30 });
      }
      return jsonResponse(true, { itemSummaries: [] });
    });
    const fetchArg = fetchFn as unknown as typeof fetch;
    expect(await searchEbayListings('phone', { fetchFn: fetchArg })).toEqual({
      ok: true,
      source: 'ebay-browse-api',
      listings: [],
    });
    expect(await searchEbayListings('phone', { fetchFn: fetchArg })).toEqual({
      ok: true,
      source: 'ebay-browse-api',
      listings: [],
    });
    // Two searches, two token fetches: the expired token is never reused.
    expect(tokenCalls).toBe(2);
  });

  it('returns rate-limited (not api-error) on HTTP 429', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(false, { errors: [{ message: 'rate limited' }] }, 429);
    });
    const result = await searchEbayListings('phone', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'rate-limited', listings: [] });
  });

  it('returns api-error on malformed JSON', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      };
    });
    const result = await searchEbayListings('phone', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, reason: 'api-error', listings: [] });
  });

  it('returns an empty list when itemSummaries is missing', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(true, { total: 0 });
    });
    const result = await searchEbayListings('phone', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true, source: 'ebay-browse-api', listings: [] });
  });

  it('passes non-USD currencies through and nulls negative prices', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(true, {
        itemSummaries: [
          {
            itemId: 'eur-1',
            title: 'Sony WH-1000XM5',
            price: { value: '299.00', currency: 'EUR' },
            condition: 'New',
            itemWebUrl: 'https://www.ebay.com/itm/eur-1',
          },
          {
            itemId: 'neg-1',
            title: 'Broken price row',
            price: { value: '-5', currency: 'USD' },
            condition: 'Used',
            itemWebUrl: 'https://www.ebay.com/itm/neg-1',
          },
        ],
      });
    });
    const result = await searchEbayListings('headphones', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listings).toHaveLength(2);
    // Non-USD passes through unchanged — conversion is a caller
    // concern, never silently applied here.
    expect(result.listings[0].currency).toBe('EUR');
    expect(result.listings[0].price).toBe(299);
    // A negative price is unparseable as an asking price → null.
    expect(result.listings[1].price).toBeNull();
    expect(result.listings[1].currency).toBe('USD');
  });

  it('uses the marketplace override header when EBAY_MARKETPLACE_ID is set', async () => {
    setEnv({
      [CLIENT_ID]: 'test-id',
      [CLIENT_SECRET]: 'test-secret',
      [MARKETPLACE]: 'EBAY_GB',
    });
    const fetchFn = vi.fn(async (url: string, init?: unknown) => {
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(true, { itemSummaries: [] });
    });
    const result = await searchEbayListings('phone', {
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    const searchCall = fetchFn.mock.calls.find(([url]) =>
      (url as string).includes('item_summary/search')
    );
    expect(searchCall).toBeDefined();
    const init = searchCall![1] as { headers: Record<string, string> };
    expect(init.headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_GB');
  });

  it('sends the condition filter when a valid condition is given, and ignores an invalid one', async () => {
    setEnv({ [CLIENT_ID]: 'test-id', [CLIENT_SECRET]: 'test-secret' });
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('oauth2/token')) {
        return jsonResponse(true, { access_token: 'tok-1', expires_in: 3600 });
      }
      return jsonResponse(true, { itemSummaries: [] });
    });
    const fetchArg = fetchFn as unknown as typeof fetch;
    await searchEbayListings('phone', { fetchFn: fetchArg, condition: 'NEW' });
    const searchUrl = urls.find((u) => u.includes('item_summary/search')) ?? '';
    expect(searchUrl).toContain('filter=');
    expect(decodeURIComponent(searchUrl)).toContain('conditions:{NEW}');

    urls.length = 0;
    resetEbayTokenCacheForTests();
    await searchEbayListings('phone', { fetchFn: fetchArg, condition: 'NOT_A_CONDITION' });
    const searchUrl2 = urls.find((u) => u.includes('item_summary/search')) ?? '';
    expect(searchUrl2).not.toContain('filter=');
  });
});
