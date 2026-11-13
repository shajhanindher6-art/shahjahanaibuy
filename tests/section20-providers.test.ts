/**
 * Section 20 — CSV / Mock provider tests (audit §12 #105, §10
 * "Merchant adapters — NONE (direct)").
 *
 * Covers, with no network and no DB:
 * - CsvProvider: parsing/validation paths (quoted fields, escaped
 *   quotes, embedded newlines, short rows, alternate column names),
 *   search/fetch filtering, unavailable state, csvUrl fetch failure.
 * - parseCsvDocument (exported row parser with line numbers).
 * - MockProvider: search/fetch, always-available contract.
 * - ProviderRegistry: priority ordering, retailer overrides, and
 *   the production guard — MockProvider is registered only when
 *   NODE_ENV !== 'production' (getProviderRegistry singleton).
 *
 * Deliberately NOT covered here: Apify fail-closed behaviour —
 * already covered by tests/section16-apify-guard.test.ts.
 *
 * Section 20, §12 #99: a configured csvUrl is fetched server-side
 * and must pass the SSRF guard (services/visual-search.ts
 * isSafePublicImageUrl — DNS-resolves the host). That guard is
 * mocked here so csvUrl tests are hermetic; one test flips it off
 * to prove a refused URL never reaches fetch.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const csvGuardState = vi.hoisted(() => ({ pass: true }));

vi.mock('@/services/visual-search', () => ({
  isSafePublicImageUrl: async () => csvGuardState.pass,
}));
import { CsvProvider, parseCsvDocument } from '@/services/providers/csv-provider';
import { MockProvider } from '@/services/providers/mock-provider';
import {
  ProviderRegistry,
  getProviderRegistry,
  resetProviderRegistry,
} from '@/services/providers/registry';
import type { RawProductData } from '@/services/providers/types';

// ---------------------------------------------------------------------------
// parseCsvDocument
// ---------------------------------------------------------------------------

describe('parseCsvDocument', () => {
  it('parses a header row into lower-cased keys', () => {
    const rows = parseCsvDocument('Name,Price,Brand\nSony Headphones,299,Sony\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toEqual({ name: 'Sony Headphones', price: '299', brand: 'Sony' });
    expect(rows[0].rowNumber).toBe(2);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const rows = parseCsvDocument(
      'name,description\n"Widget, Pro","Say ""hi"" to sound"\n'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].row.name).toBe('Widget, Pro');
    expect(rows[0].row.description).toBe('Say "hi" to sound');
  });

  it('handles embedded newlines inside quoted fields and keeps line numbers', () => {
    const rows = parseCsvDocument(
      'name,description\nWidget,"line one\nline two"\nSecond,plain\n'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].row.description).toBe('line one\nline two');
    expect(rows[0].rowNumber).toBe(2);
    // rowNumber counts logical lines: the embedded newline inside
    // the quoted field does not advance the counter, so the next
    // row is logical line 3, not physical line 4.
    expect(rows[1].rowNumber).toBe(3);
  });

  it('keeps short rows with empty strings instead of dropping them', () => {
    const rows = parseCsvDocument('name,price,brand\nWidget,299\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toEqual({ name: 'Widget', price: '299', brand: '' });
  });

  it('skips blank lines and returns [] for an empty document', () => {
    expect(parseCsvDocument('')).toEqual([]);
    expect(parseCsvDocument('name,price\n\n\n')).toEqual([]);
  });

  it('normalizes CRLF line endings', () => {
    const rows = parseCsvDocument('name,price\r\nWidget,299\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].row.name).toBe('Widget');
  });
});

// ---------------------------------------------------------------------------
// CsvProvider
// ---------------------------------------------------------------------------

const CSV = [
  'name,price,currency,brand,category,retailerSlug,externalId,availability,url',
  'Sony WH-1000XM5,299,USD,Sony,Electronics > Headphones,amazon,ext-sony-1,in stock,https://example.com/sony',
  'Apple AirPods Pro,249,USD,Apple,Electronics > Earbuds,amazon,ext-airpods-1,in stock,https://example.com/airpods',
  'Dyson V15,749.99,USD,Dyson,Home > Vacuums,bestbuy,ext-dyson-1,limited,https://example.com/dyson',
  ',199,USD,NoName,Electronics,amazon,ext-noname-1,in stock,https://example.com/noname',
].join('\n');

describe('CsvProvider', () => {
  it('is unavailable with no csv and no csvUrl; search/fetch throw NOT_CONFIGURED', async () => {
    const provider = new CsvProvider({});
    expect(provider.key).toBe('csv');
    expect(provider.isAvailable()).toBe(false);
    // Sections 21–25, Stage B (B1) — was a silent [] / null, read
    // as "checked, no results". Unconfigured now throws a typed
    // error naming the missing source.
    await expect(provider.search({ query: 'sony' })).rejects.toThrow(/no source configured/);
    await expect(
      provider.fetch({ externalId: 'ext-sony-1', retailerSlug: 'amazon' })
    ).rejects.toThrow(/no source configured/);
  });

  it('parses rows and drops the nameless row', async () => {
    const provider = new CsvProvider({ csv: CSV });
    expect(provider.isAvailable()).toBe(true);
    const all = await provider.search({ query: '' });
    expect(all).toHaveLength(3);
    expect(all.map((p) => p.externalId)).toEqual(['ext-sony-1', 'ext-airpods-1', 'ext-dyson-1']);
  });

  it('search requires every query term to match name/description/brand/category', async () => {
    const provider = new CsvProvider({ csv: CSV });
    expect((await provider.search({ query: 'sony headphones' })).map((p) => p.externalId)).toEqual([
      'ext-sony-1',
    ]);
    expect(await provider.search({ query: 'sony dyson' })).toEqual([]);
    expect((await provider.search({ query: 'ELECTRONICS' })).length).toBe(2);
  });

  it('search filters by retailerSlug and honours limit', async () => {
    const provider = new CsvProvider({ csv: CSV });
    const bestbuy = await provider.search({ query: '', retailerSlug: 'BESTBUY' });
    expect(bestbuy).toHaveLength(1);
    expect(bestbuy[0].externalId).toBe('ext-dyson-1');
    expect((await provider.search({ query: '', limit: 2 })).length).toBe(2);
    expect((await provider.search({ query: '', limit: 0 })).length).toBe(3);
  });

  it('fetch finds by externalId + retailerSlug (case-insensitive) and misses otherwise', async () => {
    const provider = new CsvProvider({ csv: CSV });
    const found = await provider.fetch({ externalId: 'ext-sony-1', retailerSlug: 'AMAZON' });
    expect(found?.name).toBe('Sony WH-1000XM5');
    expect(await provider.fetch({ externalId: 'ext-sony-1', retailerSlug: 'bestbuy' })).toBeNull();
    expect(await provider.fetch({ externalId: 'nope', retailerSlug: 'amazon' })).toBeNull();
  });

  it('maps alternate column names (title, sale_price, image_url)', async () => {
    const csv = [
      'title,sale_price,currency,manufacturer,product_type,image_url',
      'Widget Pro,49.50,EUR,Acme,Gadgets,https://example.com/w.jpg|https://example.com/w2.jpg',
    ].join('\n');
    const provider = new CsvProvider({ csv });
    const [product] = await provider.search({ query: '' });
    expect(product.name).toBe('Widget Pro');
    expect(product.price).toBe(49.5);
    expect(product.currency).toBe('EUR');
    expect(product.brand).toBe('Acme');
    expect(product.category).toBe('Gadgets');
    expect(product.images).toEqual(['https://example.com/w.jpg', 'https://example.com/w2.jpg']);
  });

  it('defaults missing price to 0, missing currency to USD, missing retailer to the default slug', async () => {
    const csv = 'name,brand\nPlain Widget,Acme\n';
    const provider = new CsvProvider({ csv, defaultRetailerSlug: 'amazon' });
    const [product] = await provider.search({ query: '' });
    expect(product.price).toBe(0);
    expect(product.currency).toBe('USD');
    expect(product.retailerSlug).toBe('amazon');
    expect(product.availability).toBe('unknown');
  });

  it('normalizes availability values', async () => {
    const csv = [
      'name,availability',
      'A,In Stock',
      'B,out of stock',
      'C,limited stock',
      'D,pre-order',
      'E,maybe',
    ].join('\n');
    const provider = new CsvProvider({ csv });
    const products = await provider.search({ query: '' });
    expect(products.map((p) => p.availability)).toEqual([
      'in_stock',
      'out_of_stock',
      'limited',
      'preorder',
      'unknown',
    ]);
  });

  it('generates a csv- prefixed externalId when the row has none', async () => {
    const provider = new CsvProvider({ csv: 'name,price\nWidget,10\n' });
    const [product] = await provider.search({ query: '' });
    expect(product.externalId).toMatch(/^csv-/);
  });

  it('caches the parse: a second search does not re-fetch the URL', async () => {
    const fetchSpy = vi.fn(async () => new Response(CSV, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const provider = new CsvProvider({ csvUrl: 'https://example.com/feed.csv' });
      await provider.search({ query: '' });
      await provider.search({ query: 'sony' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws without fetching when the SSRF guard refuses the csvUrl (§12 #99)', async () => {
    csvGuardState.pass = false;
    const fetchSpy = vi.fn(async () => new Response(CSV, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const provider = new CsvProvider({ csvUrl: 'https://169.254.169.254/feed.csv' });
      await expect(provider.search({ query: '' })).rejects.toThrow(/SSRF/);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      csvGuardState.pass = true;
    }
  });

  it('throws when the csvUrl fetch fails (non-OK or network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    try {
      const provider = new CsvProvider({ csvUrl: 'https://example.com/feed.csv' });
      await expect(provider.search({ query: '' })).rejects.toThrow(/HTTP 500/);
    } finally {
      vi.unstubAllGlobals();
    }

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    try {
      const provider = new CsvProvider({ csvUrl: 'https://example.com/feed.csv' });
      await expect(provider.search({ query: '' })).rejects.toThrow(/network down/);
      await expect(
        provider.fetch({ externalId: 'x', retailerSlug: 'amazon' })
      ).rejects.toThrow(/network down/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// MockProvider
// ---------------------------------------------------------------------------

describe('MockProvider', () => {
  it('is always available (test data only — never registered in prod)', () => {
    const provider = new MockProvider();
    expect(provider.key).toBe('mock');
    expect(provider.isAvailable()).toBe(true);
  });

  it('searches the fixed catalog by query terms', async () => {
    const provider = new MockProvider();
    const sony = await provider.search({ query: 'sony headphones' });
    expect(sony).toHaveLength(1);
    expect(sony[0].externalId).toBe('mock-001');
    expect(await provider.search({ query: 'sony dyson' })).toEqual([]);
  });

  it('filters by retailerSlug and limit', async () => {
    const provider = new MockProvider();
    const amazon = await provider.search({ query: '', retailerSlug: 'amazon' });
    expect(amazon.length).toBeGreaterThan(0);
    expect(amazon.every((p) => p.retailerSlug === 'amazon')).toBe(true);
    expect((await provider.search({ query: '', limit: 1 })).length).toBe(1);
  });

  it('fetch returns the product by id + retailer, null on miss', async () => {
    const provider = new MockProvider();
    const found = await provider.fetch({ externalId: 'mock-003', retailerSlug: 'BESTBUY' });
    expect(found?.name).toContain('Samsung Galaxy S23');
    expect(await provider.fetch({ externalId: 'mock-003', retailerSlug: 'amazon' })).toBeNull();
    expect(await provider.fetch({ externalId: 'mock-999', retailerSlug: 'amazon' })).toBeNull();
  });

  it('accepts a custom product list', async () => {
    const custom: RawProductData[] = [
      {
        externalId: 'c-1',
        retailerSlug: 'amazon',
        name: 'Custom Widget',
        price: 10,
        currency: 'USD',
        availability: 'in_stock',
      },
    ];
    const provider = new MockProvider(custom);
    expect(await provider.search({ query: '' })).toEqual(custom);
  });

  it('every mock product is a valid RawProductData (passes pipeline validation)', async () => {
    const { validateRawProduct } = await import('@/services/pipeline/validation');
    const provider = new MockProvider();
    const products = await provider.search({ query: '' });
    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(validateRawProduct(product).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ProviderRegistry + production guard
// ---------------------------------------------------------------------------

describe('ProviderRegistry', () => {
  it('getPreferred picks csv_import over mock (priority order)', async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider());
    registry.register(new CsvProvider({ csv: CSV }));
    expect(registry.getPreferred()?.key).toBe('csv');
  });

  it('getPreferred returns undefined when nothing is available', () => {
    const registry = new ProviderRegistry();
    registry.register(new CsvProvider({})); // unavailable: no csv/csvUrl
    expect(registry.getPreferred()).toBeUndefined();
    expect(registry.getAvailable()).toEqual([]);
  });

  it('getForRetailer honours an override when available, else returns undefined — no silent fallback', () => {
    const registry = new ProviderRegistry();
    const mock = new MockProvider();
    registry.register(mock);
    registry.register(new CsvProvider({ csv: CSV }));
    registry.setRetailerOverride('amazon', 'csv');
    expect(registry.getForRetailer('amazon')?.key).toBe('csv');
    // Sections 21–25, Stage B — an override pointing at an
    // unavailable provider used to fall back to another merchant
    // silently. It now returns undefined: the caller must record
    // "no provider for this retailer" honestly, never fetch from
    // a merchant the retailer did not ask for.
    registry.setRetailerOverride('amazon', 'csv');
    registry.unregister('csv');
    expect(registry.getForRetailer('amazon')).toBeUndefined();
  });

  it('unregister removes a provider; get/getAll/getByCategory reflect it', () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider());
    expect(registry.get('mock')?.name).toBe('Mock Provider');
    expect(registry.getByCategory('mock')).toHaveLength(1);
    expect(registry.unregister('mock')).toBe(true);
    expect(registry.get('mock')).toBeUndefined();
    expect(registry.getAll()).toEqual([]);
  });
});

describe('getProviderRegistry production guard', () => {
  beforeEach(() => {
    resetProviderRegistry();
  });

  afterEach(() => {
    // process.env.NODE_ENV is read-only under the current
    // @types/node, so direct assignment fails tsc (TS2540);
    // vi.stubEnv is the repo's established pattern for this.
    vi.unstubAllEnvs();
    resetProviderRegistry();
  });

  it('registers MockProvider outside production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const registry = getProviderRegistry();
    expect(registry.getAll().map((p) => p.key)).toContain('mock');
    expect(registry.get('mock')?.isAvailable()).toBe(true);
  });

  it('does NOT register MockProvider in production (fake products must never reach prod)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const registry = getProviderRegistry();
    expect(registry.getAll().map((p) => p.key)).not.toContain('mock');
    expect(registry.get('mock')).toBeUndefined();
    // With no real provider configured, nothing is preferred in prod.
    expect(registry.getPreferred()).toBeUndefined();
  });
});
