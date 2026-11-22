/**
 * Regression tests for the CJ GraphQL importer CLI
 * (scripts/import-cj-graphql) — probe mode and --limit.
 *
 * The --probe contract: exactly ONE API call, no database writes.
 * Regression (review 2026-11-22 §4.1): probe mode used to keep
 * paginating — the --limit stop never fired in probe mode because
 * its flag defaults to 0, so a large catalog with a page token
 * would fetch up to maxPages/maxTotal. The fix is in the onPage
 * callback: probe returns false after the first page.
 *
 * fetch is stubbed globally (vi.stubGlobal) — no network, no DB.
 * The Personal Access Token is a fake test value, never sent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { importCjGraphql, type CliOptions } from '@/scripts/import-cj-graphql';
import type { CjShoppingProduct } from '@/lib/offers/cj-graphql';

const TEST_TOKEN = 'test-token-abc';

function validProduct(overrides: Partial<CjShoppingProduct> = {}): CjShoppingProduct {
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

function pageResponse(
  products: CjShoppingProduct[],
  totalCount: number,
  pageToken?: string,
): unknown {
  return {
    data: {
      shoppingProducts: {
        totalCount,
        limit: products.length,
        count: products.length,
        ...(pageToken !== undefined ? { page: pageToken } : {}),
        resultList: products,
      },
    },
  };
}

type MockResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

function mockResponse(body: unknown): MockResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

/** Queue-based stub fetch; records every call. */
function stubFetch(responses: MockResponse[]): { calls: unknown[] } {
  const calls: unknown[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body));
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return response;
    },
  );
  return { calls };
}

function baseOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    gtin: '',
    advertiserId: '3992613',
    advertiserName: 'DHGate',
    companyId: '8130731',
    limit: 0,
    onlyWithGtin: false,
    pageSize: 1000,
    minIntervalMs: 0,
    probe: false,
    dryRun: false,
    ...overrides,
  };
}

let savedToken: string | undefined;

function setTestToken(): void {
  savedToken = process.env.CJ_PERSONAL_ACCESS_TOKEN;
  process.env.CJ_PERSONAL_ACCESS_TOKEN = TEST_TOKEN;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedToken === undefined) {
    delete process.env.CJ_PERSONAL_ACCESS_TOKEN;
  } else {
    process.env.CJ_PERSONAL_ACCESS_TOKEN = savedToken;
  }
});

describe('importCjGraphql --probe', () => {
  it('makes exactly ONE API call on a large catalog with a page token', async () => {
    setTestToken();
    const { calls } = stubFetch([
      mockResponse(pageResponse([validProduct()], 1_118_904, 'token-abc')),
    ]);
    const stats = await importCjGraphql(baseOptions({ probe: true }));
    // One call only — the page token must NOT trigger a second fetch.
    expect(calls).toHaveLength(1);
    expect(stats.processed).toBe(1);
    expect(stats.accepted).toBe(1);
    // Zero database writes in probe mode: nothing upserted, the row
    // is only counted as would-be-upserted.
    expect(stats.upserted).toBe(0);
    expect(stats.wouldUpsert).toBe(1);
    expect(stats.errors).toBe(0);
  });

  it('makes exactly ONE API call in offset mode too (small catalog)', async () => {
    setTestToken();
    const { calls } = stubFetch([
      mockResponse(pageResponse([validProduct()], 3)),
      mockResponse(
        pageResponse([validProduct({ id: 'DHG-1002' })], 3),
      ),
    ]);
    const stats = await importCjGraphql(baseOptions({ probe: true }));
    expect(calls).toHaveLength(1);
    expect(stats.processed).toBe(1);
    expect(stats.upserted).toBe(0);
  });
});

describe('importCjGraphql --limit (unchanged behavior)', () => {
  it('still paginates and stops at --limit in dry-run mode', async () => {
    setTestToken();
    const { calls } = stubFetch([
      mockResponse(pageResponse([validProduct()], 3)),
      mockResponse(
        pageResponse([validProduct({ id: 'DHG-1002' })], 3),
      ),
    ]);
    const stats = await importCjGraphql(
      baseOptions({ dryRun: true, limit: 2 }),
    );
    // Two pages fetched, then the --limit stop fires.
    expect(calls).toHaveLength(2);
    expect(stats.processed).toBe(2);
    expect(stats.accepted).toBe(2);
    expect(stats.upserted).toBe(0);
    expect(stats.wouldUpsert).toBe(2);
  });
});
