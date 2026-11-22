/**
 * Unit tests for the CJ GraphQL Product Search client
 * (lib/offers/cj-graphql). fetch is injected — no network, no
 * database, no live CJ calls. The Personal Access Token is never
 * asserted into any error message.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildFeedSummaryQuery,
  buildShoppingProductsQuery,
  CjGraphqlError,
  searchShoppingProducts,
  toMerchantOfferRow,
  type CjFetch,
  type CjGraphqlConfig,
  type CjShoppingProduct,
} from '@/lib/offers/cj-graphql';
import type { TransformContext } from '@/lib/offers/cj-feed-transform';

const TEST_TOKEN = 'test-token-abc';
const BASE_CONFIG: CjGraphqlConfig = {
  companyId: '8130731',
  personalAccessToken: TEST_TOKEN,
  minIntervalMs: 0,
  retryBaseMs: 1,
  maxRetries: 3,
  timeoutMs: 5000,
};

function loadFixture(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'),
  );
}

type MockResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

function mockResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  };
}

/** Queue-based mock fetch; records every call's parsed body. */
function makeMockFetch(responses: MockResponse[]): {
  fetchImpl: CjFetch;
  calls: Array<{ url: string; body: unknown }>;
} {
  const calls: Array<{ url: string; body: unknown }> = [];
  let index = 0;
  const fetchImpl: CjFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  };
  return { fetchImpl, calls };
}

const CTX: TransformContext = {
  network: 'cj',
  advertiserId: '3992613',
  advertiserName: 'DHGate',
  onlyWithGtin: false,
  psaApproved: false,
  syncedAt: '2026-11-22T00:00:00.000Z',
};

function baseProduct(overrides: Partial<CjShoppingProduct> = {}): CjShoppingProduct {
  return {
    id: 'DHG-1001',
    title: 'Wireless Earbuds Pro',
    description: 'Bluetooth earbuds.',
    price: { amount: '49.99', currency: 'USD' },
    salePrice: null,
    availability: 'in stock',
    condition: 'new',
    brand: 'SoundPro',
    gtin: '4006381333931',
    mpn: 'SP-1001',
    identifierExists: true,
    imageLink: 'https://example.com/img1.jpg',
    additional_image_link: null,
    link: 'https://example.com/p1',
    mobile_link: null,
    google_product_category: 'Electronics > Audio',
    product_type: 'Audio',
    item_group_id: null,
    advertiserId: '3992613',
    catalogId: 'DHG-CAT-1',
    itemListId: null,
    linkCode: { clickUrl: 'https://www.dpbolvw.net/click-1001' },
    ...overrides,
  };
}

describe('buildShoppingProductsQuery', () => {
  it('always includes companyId and passes arguments as variables', () => {
    const built = buildShoppingProductsQuery(
      { partnerIds: ['3992613'], gtin: '4006381333931', limit: 10, offset: 0 },
      { companyId: '8130731' },
    );
    expect(built.variables.companyId).toBe('8130731');
    expect(built.variables.gtin).toBe('4006381333931');
    expect(built.variables.partnerIds).toEqual(['3992613']);
    // Values are never interpolated into the query text.
    expect(built.query).not.toContain('4006381333931');
    expect(built.query).not.toContain('8130731');
  });

  it('omits linkCode without a PID and includes it with one', () => {
    const withoutPid = buildShoppingProductsQuery({}, { companyId: '8130731' });
    expect(withoutPid.query).not.toContain('linkCode');
    const withPid = buildShoppingProductsQuery(
      {},
      { companyId: '8130731', pid: '1234567' },
    );
    expect(withPid.query).toContain('linkCode(pid: "1234567")');
  });

  it('requires companyId', () => {
    expect(() => buildShoppingProductsQuery({}, { companyId: '' })).toThrow(
      /companyId/,
    );
  });
});

describe('buildFeedSummaryQuery', () => {
  it('includes companyId and optional partnerIds', () => {
    const built = buildFeedSummaryQuery('8130731', ['3992613']);
    expect(built.variables).toEqual({ companyId: '8130731', partnerIds: ['3992613'] });
    expect(built.query).toContain('shoppingProductFeeds');
  });
});

describe('searchShoppingProducts', () => {
  it('pages in offset mode until totalCount is reached', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      mockResponse(loadFixture('cj-graphql-shopping-page-1.json')),
      mockResponse(loadFixture('cj-graphql-shopping-page-2.json')),
    ]);
    const seen: string[] = [];
    const result = await searchShoppingProducts(
      { partnerIds: ['3992613'] },
      async (page) => {
        for (const product of page.resultList) seen.push(product.id);
      },
      BASE_CONFIG,
      fetchImpl,
    );
    expect(result).toEqual({ pages: 2, total: 3 });
    expect(seen).toEqual(['DHG-1001', 'DHG-1002', 'DHG-1003']);
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { variables: Record<string, unknown> }).variables.offset).toBe(2);
  });

  it('switches to page-token mode above 10,000 and never sends offset', async () => {
    const firstPage = {
      data: {
        shoppingProducts: {
          totalCount: 15000,
          limit: 10000,
          count: 1,
          page: 'token-abc',
          resultList: [baseProduct()],
        },
      },
    };
    const secondPage = {
      data: {
        shoppingProducts: {
          totalCount: 15000,
          limit: 10000,
          count: 1,
          resultList: [baseProduct({ id: 'DHG-1002' })],
        },
      },
    };
    const { fetchImpl, calls } = makeMockFetch([
      mockResponse(firstPage),
      mockResponse(secondPage),
    ]);
    const result = await searchShoppingProducts(
      {},
      () => undefined,
      BASE_CONFIG,
      fetchImpl,
    );
    expect(result.pages).toBe(2);
    expect(result.total).toBe(2);
    const secondVariables = (calls[1].body as { variables: Record<string, unknown> })
      .variables;
    expect(secondVariables.page).toBe('token-abc');
    expect(secondVariables.offset).toBeUndefined();
  });

  it('stops on an empty first page', async () => {
    const { fetchImpl } = makeMockFetch([
      mockResponse({
        data: { shoppingProducts: { totalCount: 0, limit: 1000, count: 0, resultList: [] } },
      }),
    ]);
    const result = await searchShoppingProducts({}, () => undefined, BASE_CONFIG, fetchImpl);
    expect(result).toEqual({ pages: 1, total: 0 });
  });

  it('stops when a page repeats IDs (stuck cursor)', async () => {
    const page1 = loadFixture('cj-graphql-shopping-page-1.json');
    const { fetchImpl, calls } = makeMockFetch([
      mockResponse(page1),
      mockResponse(page1),
    ]);
    const result = await searchShoppingProducts({}, () => undefined, BASE_CONFIG, fetchImpl);
    // The repeated page was fetched but contributed nothing — it is not
    // counted as progress, and no third call follows.
    expect(result.pages).toBe(1);
    expect(result.total).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('retries a 429 (honouring Retry-After) and a 500, then succeeds', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      mockResponse({ errors: [{ message: 'slow down' }] }, 429, { 'retry-after': '0' }),
      mockResponse({}, 500),
      mockResponse(loadFixture('cj-graphql-shopping-page-1.json')),
      mockResponse(loadFixture('cj-graphql-shopping-page-2.json')),
    ]);
    const result = await searchShoppingProducts({}, () => undefined, BASE_CONFIG, fetchImpl);
    expect(result.total).toBe(3);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('never retries auth failures and reports kind auth', async () => {
    const { fetchImpl, calls } = makeMockFetch([mockResponse({}, 401)]);
    await expect(
      searchShoppingProducts({}, () => undefined, BASE_CONFIG, fetchImpl),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });

  it('fails closed without a token and never calls fetch', async () => {
    const { fetchImpl, calls } = makeMockFetch([]);
    await expect(
      searchShoppingProducts(
        {},
        () => undefined,
        { ...BASE_CONFIG, personalAccessToken: '' },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ kind: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('rejects GraphQL errors[] even when data is present', async () => {
    const { fetchImpl } = makeMockFetch([
      mockResponse({
        data: { shoppingProducts: { totalCount: 1, limit: 1, count: 1, resultList: [] } },
        errors: [{ message: 'Field "bogus" does not exist' }],
      }),
    ]);
    await expect(
      searchShoppingProducts({}, () => undefined, BASE_CONFIG, fetchImpl),
    ).rejects.toMatchObject({ kind: 'graphql' });
  });

  it('never puts the token in an error message', async () => {
    const { fetchImpl } = makeMockFetch([mockResponse({}, 401)]);
    try {
      await searchShoppingProducts({}, () => undefined, BASE_CONFIG, fetchImpl);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CjGraphqlError);
      expect((err as Error).message).not.toContain(TEST_TOKEN);
    }
  });
});

describe('toMerchantOfferRow', () => {
  it('maps a valid product, preferring clickUrl and parsing the string price', () => {
    const result = toMerchantOfferRow(baseProduct(), CTX);
    expect(result.skipReason).toBeNull();
    expect(result.row).toMatchObject({
      network: 'cj',
      advertiser_id: '3992613',
      external_product_id: 'DHG-1001',
      price: 49.99,
      currency: 'USD',
      gtin: '4006381333931',
      affiliate_url: 'https://www.dpbolvw.net/click-1001',
      is_public_live: false,
    });
    expect(result.hasIdentifier).toBe(true);
  });

  it('parses price "135.00" and a string salePrice', () => {
    const result = toMerchantOfferRow(
      baseProduct({
        price: { amount: '135.00', currency: 'USD' },
        salePrice: '99.00 USD',
      }),
      CTX,
    );
    expect(result.row?.price).toBe(135);
    expect(result.row?.sale_price).toBe(99);
  });

  it('drops a salePrice whose explicit currency differs from the list price', () => {
    const objectForm = toMerchantOfferRow(
      baseProduct({
        price: { amount: '135.00', currency: 'EUR' },
        salePrice: { amount: '99.00', currency: 'USD' },
      }),
      CTX,
    );
    expect(objectForm.skipReason).toBeNull();
    expect(objectForm.row?.sale_price).toBeNull();
    expect(objectForm.row?.currency).toBe('EUR');
    const stringForm = toMerchantOfferRow(
      baseProduct({
        price: { amount: '135.00', currency: 'EUR' },
        salePrice: '99.00 USD',
      }),
      CTX,
    );
    expect(stringForm.row?.sale_price).toBeNull();
  });

  it('keeps a salePrice in the same currency, or one that inherits it', () => {
    const same = toMerchantOfferRow(
      baseProduct({
        price: { amount: '135.00', currency: 'EUR' },
        salePrice: { amount: '99.00', currency: 'EUR' },
      }),
      CTX,
    );
    expect(same.row?.sale_price).toBe(99);
    const bare = toMerchantOfferRow(
      baseProduct({
        price: { amount: '135.00', currency: 'EUR' },
        salePrice: '99.00',
      }),
      CTX,
    );
    expect(bare.row?.sale_price).toBe(99);
    expect(bare.row?.currency).toBe('EUR');
  });

  it('falls back to the plain link without linkCode', () => {
    const result = toMerchantOfferRow(baseProduct({ linkCode: null }), CTX);
    expect(result.row?.affiliate_url).toBe('https://example.com/p1');
  });

  it('nulls an invalid GTIN but keeps the row', () => {
    const result = toMerchantOfferRow(baseProduct({ gtin: '123' }), CTX);
    expect(result.row?.gtin).toBeNull();
    expect(result.skipReason).toBeNull();
  });

  it('skips missing id, missing title, not-in-stock, invalid price, invalid image, missing url', () => {
    const cases: Array<[Partial<CjShoppingProduct>, string]> = [
      [{ id: '' }, 'missing-id'],
      [{ title: '' }, 'missing-title'],
      [{ availability: 'out of stock' }, 'not-in-stock'],
      [{ price: { amount: '0', currency: 'USD' } }, 'invalid-price'],
      [{ price: null }, 'invalid-price'],
      [{ imageLink: 'not-a-url' }, 'invalid-image'],
      [{ linkCode: null, link: '' }, 'missing-url'],
      [{ linkCode: null, link: 'not-a-url' }, 'missing-url'],
      [{ linkCode: { clickUrl: 'ftp://example.com/buy' }, link: '' }, 'missing-url'],
    ];
    for (const [overrides, reason] of cases) {
      expect(toMerchantOfferRow(baseProduct(overrides), CTX).skipReason).toBe(reason);
    }
  });

  it('skips no-GTIN rows only with onlyWithGtin', () => {
    const noGtin = baseProduct({ gtin: null, mpn: null });
    expect(toMerchantOfferRow(noGtin, CTX).skipReason).toBeNull();
    expect(
      toMerchantOfferRow(noGtin, { ...CTX, onlyWithGtin: true }).skipReason,
    ).toBe('no-gtin');
  });
});
