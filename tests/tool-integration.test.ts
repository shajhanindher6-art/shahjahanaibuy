/**
 * Master Tool Integration, Stage 1 — ToolIntegrationService tests.
 *
 * Covers: param-schema parsing (every dialect → one model), the
 * buildToolUrl ↔ parseToolParams round-trip, cached-fetch behaviour
 * (second call hits the SWR cache, not Supabase — counted via a
 * fake client, following tests/section18-product-cache.test.ts),
 * /compare UUID resolution (resolved slugs kept, unresolvable UUIDs
 * kept as unresolved, never invented), link builders (every builder
 * carries ?product= or its translated dialect), and the data-only
 * relatedToolLinks helper.
 *
 * The fake client is a small query engine (select/eq/neq/in/is/or/
 * order/limit/range/maybeSingle/single) recording every query so the
 * tests can count DB round trips per table. Cache keys are
 * per-instance in-memory (lib/cache), so every cached-fetch test
 * uses a UNIQUE slug/id — otherwise an earlier test's warm entry
 * would mask the first call's query count.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseToolParams,
  parseAndResolveToolParams,
  resolveCompareProductSlugs,
  buildToolUrl,
  getToolProduct,
  getCachedProducts,
  getToolPriceHistory,
  getToolMerchantProducts,
  compareLink,
  compareLinkForProduct,
  compatibilityLink,
  energyCostLink,
  upgradeAdvisorLink,
  personaFitLink,
  priceMatchLink,
  ownItLink,
  dealStackerLink,
  negotiationLink,
  repairabilityLink,
  refurbishedLink,
  relatedToolLinks,
  TOOL_ROUTES,
} from '@/services/tool-integration';

type Row = Record<string, unknown>;

interface FakeTable {
  rows: Row[];
}

const fakeDb = {
  tables: {} as Record<string, FakeTable>,
  queries: [] as Array<{ table: string }>,
  fromCalls: {} as Record<string, number>,
};

function seedTable(name: string, rows: Row[] = []): void {
  fakeDb.tables[name] = { rows: rows.map((r) => ({ ...r })) };
}

function resetFakeDb(): void {
  fakeDb.tables = {};
  fakeDb.queries = [];
  fakeDb.fromCalls = {};
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private wantSingle = false;
  private wantMaybeSingle = false;

  constructor(private readonly table: string) {}

  select(): this {
    fakeDb.queries.push({ table: this.table });
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  neq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] !== value);
    return this;
  }
  in(col: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: unknown): this {
    this.filters.push((r) => (value === null ? r[col] == null : r[col] === value));
    return this;
  }
  // No test uses ?search=; the OR leg is a no-op (accept all) so the
  // chain still runs. Search filtering is getProducts' own concern.
  or(): this {
    return this;
  }
  order(col: string, opts: { ascending: boolean }): this {
    this.orderCol = col;
    this.orderAsc = opts.ascending;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  single(): this {
    this.wantSingle = true;
    return this;
  }
  maybeSingle(): this {
    this.wantMaybeSingle = true;
    return this;
  }

  then<TResult1 = { data: unknown; error: unknown; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: unknown; count?: number }> {
    const table = fakeDb.tables[this.table];
    if (!table) {
      return { data: null, error: { code: 'PGRST205', message: `Could not find the table '${this.table}'` } };
    }
    let rows = table.rows.filter((r) => this.filters.every((f) => f(r)));
    const count = rows.length;
    if (this.orderCol) {
      const col = this.orderCol;
      const asc = this.orderAsc;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (typeof av === 'number' && typeof bv === 'number') {
          return asc ? av - bv : bv - av;
        }
        const as = String(av ?? '');
        const bs = String(bv ?? '');
        return asc ? (as < bs ? -1 : as > bs ? 1 : 0) : as > bs ? -1 : as < bs ? 1 : 0;
      });
    }
    if (this.rangeFrom !== null && this.rangeTo !== null) {
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.wantMaybeSingle) return { data: rows[0] ?? null, error: null, count };
    if (this.wantSingle) {
      return rows.length === 0
        ? { data: null, error: { code: 'PGRST116', message: '0 rows' }, count }
        : { data: rows[0], error: null, count };
    }
    return { data: rows, error: null, count };
  }
}

const fakeClient = {
  from: (table: string) => {
    fakeDb.fromCalls[table] = (fakeDb.fromCalls[table] ?? 0) + 1;
    return new FakeQuery(table);
  },
} as unknown as Parameters<typeof getToolProduct>[0];

function productRow(overrides: Row = {}): Row {
  return {
    id: 'prod-1',
    name: 'Test Laptop',
    slug: 'test-laptop',
    description: 'A test product',
    brand: 'TestBrand',
    category: 'Laptops',
    image_url: null,
    gtin: null,
    model_number: null,
    confidence_score: 80,
    data_freshness: '2026-11-02T00:00:00Z',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    status: 'published',
    price_verification_status: 'unverified',
    price_verified_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function historyRow(overrides: Row = {}): Row {
  return {
    id: 'h-1',
    product_id: 'prod-1',
    retailer_id: 'ret-1',
    price: 999,
    currency: 'USD',
    availability: 'in_stock',
    url: null,
    recorded_at: '2026-11-02T00:00:00Z',
    source: null,
    observed_at: null,
    suspicious_change: null,
    verified: null,
    currency_assumed: null,
    ...overrides,
  };
}

function merchantRow(overrides: Row = {}): Row {
  return {
    id: 'mp-1',
    product_id: 'prod-1',
    merchant_id: 'm-1',
    merchant_sku: null,
    price: 999,
    compare_at_price: null,
    currency_id: null,
    availability: 'in_stock',
    url: 'https://example.com/p1',
    shipping_cost: null,
    shipping_days: null,
    in_stock: true,
    stock_quantity: null,
    last_synced_at: null,
    price_verification_status: 'unverified',
    price_source: 'manual',
    price_verified_at: null,
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetFakeDb();
});

// ---------------------------------------------------------------------------
// parseToolParams — every dialect → one model
// ---------------------------------------------------------------------------

describe('parseToolParams', () => {
  it('parses the canonical ?product= dialect', () => {
    const sel = parseToolParams(new URLSearchParams('product=test-laptop'));
    expect(sel.productSlug).toBe('test-laptop');
    expect(sel.deviceSlug).toBeNull();
    expect(sel.currentSlug).toBeNull();
    expect(sel.compareProductIds).toEqual([]);
  });

  it('translates the T10 ?device=&accessory= dialect', () => {
    const sel = parseToolParams(
      new URLSearchParams('device=test-laptop&accessory=usb-c-hub')
    );
    expect(sel.deviceSlug).toBe('test-laptop');
    expect(sel.accessorySlug).toBe('usb-c-hub');
    // The device is the canonical product when no ?product= is given.
    expect(sel.productSlug).toBe('test-laptop');
  });

  it('translates the T1 ?current=&successor= dialect', () => {
    const sel = parseToolParams(
      new URLSearchParams('current=old-laptop&successor=new-laptop')
    );
    expect(sel.currentSlug).toBe('old-laptop');
    expect(sel.successorSlug).toBe('new-laptop');
    expect(sel.productSlug).toBe('old-laptop');
  });

  it('parses /compare ?products=<uuid>,<uuid>', () => {
    const sel = parseToolParams(
      new URLSearchParams('products=11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222')
    );
    expect(sel.compareProductIds).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    // Slugs are NOT filled by parsing alone — they need a lookup.
    expect(sel.compareProductSlugs).toEqual([]);
    expect(sel.unresolvedCompareIds).toEqual([]);
    expect(sel.productSlug).toBeNull();
  });

  it('parses the T4 typed-check fields (?name=&brand=&gtin=)', () => {
    const sel = parseToolParams(
      new URLSearchParams('product=test-laptop&name=Test+Laptop&brand=TestBrand&gtin=1234567890123')
    );
    expect(sel.productSlug).toBe('test-laptop');
    expect(sel.name).toBe('Test Laptop');
    expect(sel.brand).toBe('TestBrand');
    expect(sel.gtin).toBe('1234567890123');
  });

  it('parses T2 persona/budget, T6 target/reason, T5 watts/hours/tariff, T3 status', () => {
    const sel = parseToolParams(
      new URLSearchParams(
        'persona=work&budget=500&target=800&reason=too+expensive&watts=65&hours=8&tariff=0.2&status=offers'
      )
    );
    expect(sel.persona).toBe('work');
    expect(sel.budget).toBe('500');
    expect(sel.target).toBe('800');
    expect(sel.reason).toBe('too expensive');
    expect(sel.watts).toBe('65');
    expect(sel.hours).toBe('8');
    expect(sel.tariff).toBe('0.2');
    expect(sel.status).toBe('offers');
  });

  it('treats blank values as absent and ignores unknown keys', () => {
    const sel = parseToolParams(
      new URLSearchParams('product=++&device=+&unknown=zzz&products=,')
    );
    expect(sel.productSlug).toBeNull();
    expect(sel.deviceSlug).toBeNull();
    expect(sel.compareProductIds).toEqual([]);
  });

  it('lets an explicit ?product= win over ?device= for the canonical slug', () => {
    const sel = parseToolParams(
      new URLSearchParams('product=main-product&device=other-device')
    );
    expect(sel.productSlug).toBe('main-product');
    expect(sel.deviceSlug).toBe('other-device');
  });

  it('accepts the plain-object searchParams prop a server page receives', () => {
    const sel = parseToolParams({
      product: ['test-laptop', 'ignored-second'],
      device: 'usb-device',
    });
    expect(sel.productSlug).toBe('test-laptop');
    expect(sel.deviceSlug).toBe('usb-device');
  });
});

// ---------------------------------------------------------------------------
// buildToolUrl ↔ parseToolParams round-trip, every dialect
// ---------------------------------------------------------------------------

describe('buildToolUrl round-trip', () => {
  function roundTrip(route: string, params: Parameters<typeof buildToolUrl>[1]) {
    const url = buildToolUrl(route, params);
    const qs = url.includes('?') ? url.split('?')[1] : '';
    return { url, back: parseToolParams(new URLSearchParams(qs ?? '')) };
  }

  it('round-trips the canonical ?product= dialect', () => {
    const { url, back } = roundTrip('/tools/deal-stacker', { productSlug: 'test-laptop' });
    expect(url).toBe('/tools/deal-stacker?product=test-laptop');
    expect(back.productSlug).toBe('test-laptop');
  });

  it('round-trips the T10 device/accessory dialect', () => {
    const { url, back } = roundTrip('/tools/compatibility-checker', {
      deviceSlug: 'test-laptop',
      accessorySlug: 'usb-c-hub',
    });
    expect(url).toBe('/tools/compatibility-checker?device=test-laptop&accessory=usb-c-hub');
    expect(back.deviceSlug).toBe('test-laptop');
    expect(back.accessorySlug).toBe('usb-c-hub');
    expect(back.productSlug).toBe('test-laptop');
  });

  it('round-trips the T1 current/successor dialect', () => {
    const { url, back } = roundTrip('/tools/upgrade-advisor', {
      currentSlug: 'old-laptop',
      successorSlug: 'new-laptop',
    });
    expect(url).toBe('/tools/upgrade-advisor?current=old-laptop&successor=new-laptop');
    expect(back.currentSlug).toBe('old-laptop');
    expect(back.successorSlug).toBe('new-laptop');
    expect(back.productSlug).toBe('old-laptop');
  });

  it('round-trips /compare ?products=<uuid>,<uuid>', () => {
    const ids = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ];
    const { url, back } = roundTrip('/compare', { compareProductIds: ids });
    expect(url).toBe(`/compare?products=${ids.join('%2C')}`);
    expect(back.compareProductIds).toEqual(ids);
  });

  it('round-trips T4 extras, T2 persona/budget, T3 status, T5 and T6 extras', () => {
    const ownIt = roundTrip('/tools/own-it-check', {
      productSlug: 'test-laptop',
      name: 'Test Laptop',
      brand: 'TestBrand',
      gtin: '1234567890123',
    });
    expect(ownIt.back.productSlug).toBe('test-laptop');
    expect(ownIt.back.gtin).toBe('1234567890123');

    const persona = roundTrip('/tools/persona-fit', { persona: 'work', budget: '500' });
    expect(persona.url).toBe('/tools/persona-fit?persona=work&budget=500');
    expect(persona.back.persona).toBe('work');
    expect(persona.back.budget).toBe('500');
    // T2 takes no product param — none is emitted.
    expect(persona.url).not.toContain('product=');

    const priceMatch = roundTrip('/tools/price-match', { status: 'offers' });
    expect(priceMatch.url).toBe('/tools/price-match?status=offers');
    expect(priceMatch.back.status).toBe('offers');

    const energy = roundTrip('/tools/energy-cost', {
      productSlug: 'test-laptop',
      watts: '65',
      hours: '8',
      tariff: '0.2',
    });
    expect(energy.back.watts).toBe('65');
    expect(energy.back.productSlug).toBe('test-laptop');

    const negotiation = roundTrip('/tools/negotiation-coach', {
      productSlug: 'test-laptop',
      target: '800',
      reason: 'too expensive',
    });
    expect(negotiation.back.target).toBe('800');
    expect(negotiation.back.reason).toBe('too expensive');
  });

  it('defaults an unknown route to the canonical ?product= dialect', () => {
    const url = buildToolUrl('/tools/some-future-tool', { productSlug: 'test-laptop' });
    expect(url).toBe('/tools/some-future-tool?product=test-laptop');
  });

  it('returns the bare route when there is nothing to carry (never an empty query)', () => {
    expect(buildToolUrl('/tools/deal-stacker', {})).toBe('/tools/deal-stacker');
    expect(buildToolUrl('/tools/deal-stacker', { productSlug: null })).toBe(
      '/tools/deal-stacker'
    );
    expect(buildToolUrl('/compare', { compareProductIds: [] })).toBe('/compare');
    expect(buildToolUrl('/tools/persona-fit', {})).toBe('/tools/persona-fit');
  });

  it('falls back to productSlug for the T10 device and T1 current slots', () => {
    expect(buildToolUrl('/tools/compatibility-checker', { productSlug: 'test-laptop' })).toBe(
      '/tools/compatibility-checker?device=test-laptop'
    );
    expect(buildToolUrl('/tools/upgrade-advisor', { productSlug: 'test-laptop' })).toBe(
      '/tools/upgrade-advisor?current=test-laptop'
    );
  });
});

// ---------------------------------------------------------------------------
// /compare UUID resolution
// ---------------------------------------------------------------------------

describe('resolveCompareProductSlugs', () => {
  it('resolves known UUIDs to slugs and keeps the rest unresolved', async () => {
    seedTable('products', [
      productRow({ id: 'uuid-aaa', slug: 'alpha-laptop' }),
      productRow({ id: 'uuid-bbb', slug: 'beta-phone' }),
    ]);
    const result = await resolveCompareProductSlugs(fakeClient, [
      'uuid-aaa',
      'uuid-missing',
      'uuid-bbb',
    ]);
    expect(result.slugs).toEqual(['alpha-laptop', 'beta-phone']);
    // The unresolvable UUID is kept — never invented into a slug.
    expect(result.unresolved).toEqual(['uuid-missing']);
  });

  it('parseAndResolveToolParams fills slugs + unresolved on the parsed model', async () => {
    seedTable('products', [productRow({ id: 'uuid-ccc', slug: 'gamma-tablet' })]);
    const sel = await parseAndResolveToolParams(
      fakeClient,
      new URLSearchParams('products=uuid-ccc,uuid-nope')
    );
    expect(sel.compareProductIds).toEqual(['uuid-ccc', 'uuid-nope']);
    expect(sel.compareProductSlugs).toEqual(['gamma-tablet']);
    expect(sel.unresolvedCompareIds).toEqual(['uuid-nope']);
  });
});

// ---------------------------------------------------------------------------
// Cached fetch — second call hits the cache, not Supabase
// ---------------------------------------------------------------------------

describe('cached tool fetch', () => {
  it('getToolProduct hits products once for two calls', async () => {
    seedTable('products', [productRow({ slug: 'ti-cache-product-a' })]);
    const first = await getToolProduct(fakeClient, 'ti-cache-product-a');
    const second = await getToolProduct(fakeClient, 'ti-cache-product-a');
    expect(first?.slug).toBe('ti-cache-product-a');
    expect(second).toEqual(first);
    expect(fakeDb.fromCalls['products']).toBe(1);
  });

  it('getToolProduct returns null for an unknown slug (honest empty state)', async () => {
    seedTable('products', [productRow({ slug: 'ti-cache-product-b' })]);
    const product = await getToolProduct(fakeClient, 'ti-no-such-slug');
    expect(product).toBeNull();
  });

  it('getToolPriceHistory hits price_history once for two calls', async () => {
    seedTable('price_history', [
      historyRow({ product_id: 'ti-hist-1', price: 100, recorded_at: '2026-11-02T00:00:00Z' }),
      historyRow({ id: 'h-2', product_id: 'ti-hist-1', price: 90, recorded_at: '2026-11-01T00:00:00Z' }),
    ]);
    const first = await getToolPriceHistory(fakeClient, 'ti-hist-1');
    const second = await getToolPriceHistory(fakeClient, 'ti-hist-1');
    expect(first.history).toHaveLength(2);
    expect(first.currentPrice).toBe(100);
    expect(first.lowestPrice).toBe(90);
    expect(second).toEqual(first);
    expect(fakeDb.fromCalls['price_history']).toBe(1);
  });

  it('getToolMerchantProducts hits merchant_products once for two calls', async () => {
    seedTable('merchant_products', [
      merchantRow({ id: 'mp-x', product_id: 'ti-merch-1', price: 100 }),
      merchantRow({ id: 'mp-y', product_id: 'ti-merch-1', price: 90 }),
    ]);
    const first = await getToolMerchantProducts(fakeClient, 'ti-merch-1');
    const second = await getToolMerchantProducts(fakeClient, 'ti-merch-1');
    expect(first).toHaveLength(2);
    expect(first[0]?.price).toBe(90); // cheapest first, as before
    expect(second).toEqual(first);
    expect(fakeDb.fromCalls['merchant_products']).toBe(1);
  });

  it('getCachedProducts hits products once for two identical list calls', async () => {
    seedTable('products', [
      productRow({ id: 'ti-list-1', slug: 'ti-list-alpha', name: 'Alpha', created_at: '2026-11-02T00:00:00Z' }),
      productRow({ id: 'ti-list-2', slug: 'ti-list-beta', name: 'Beta', created_at: '2026-11-01T00:00:00Z' }),
    ]);
    seedTable('merchant_products', []);
    const first = await getCachedProducts(fakeClient, { pageSize: 10 });
    const second = await getCachedProducts(fakeClient, { pageSize: 10 });
    expect(first.products).toHaveLength(2);
    expect(first.total).toBe(2);
    expect(second).toEqual(first);
    expect(fakeDb.fromCalls['products']).toBe(1);
  });

  it('getCachedProducts treats different list options as a different entry', async () => {
    seedTable('products', [
      productRow({ id: 'ti-list-3', slug: 'ti-list-gamma', name: 'Gamma', category: 'Laptops', created_at: '2026-11-02T00:00:00Z' }),
    ]);
    seedTable('merchant_products', []);
    await getCachedProducts(fakeClient, { pageSize: 5 });
    await getCachedProducts(fakeClient, { pageSize: 5, category: 'Laptops' });
    expect(fakeDb.fromCalls['products']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Link builders
// ---------------------------------------------------------------------------

describe('cross-tool link builders', () => {
  it('compareLink carries ?products=<uuid>,<uuid> and bare /compare with no ids', () => {
    expect(compareLink(['id-1', 'id-2'])).toBe('/compare?products=id-1,id-2');
    expect(compareLink([])).toBe('/compare');
  });

  it('compareLinkForProduct resolves a slug to its id; unknown slug → bare /compare', async () => {
    seedTable('products', [productRow({ id: 'ti-cmp-1', slug: 'ti-cmp-product' })]);
    expect(await compareLinkForProduct(fakeClient, 'ti-cmp-product')).toBe(
      '/compare?products=ti-cmp-1'
    );
    expect(await compareLinkForProduct(fakeClient, 'ti-no-such-slug')).toBe('/compare');
  });

  it('every product-carrying builder emits ?product= (or its translated dialect)', () => {
    expect(compatibilityLink('device-x', 'acc-y')).toBe(
      '/tools/compatibility-checker?device=device-x&accessory=acc-y'
    );
    expect(compatibilityLink('device-x')).toBe('/tools/compatibility-checker?device=device-x');
    expect(energyCostLink('test-laptop')).toBe('/tools/energy-cost?product=test-laptop');
    expect(upgradeAdvisorLink('old-laptop', 'new-laptop')).toBe(
      '/tools/upgrade-advisor?current=old-laptop&successor=new-laptop'
    );
    expect(upgradeAdvisorLink('old-laptop')).toBe('/tools/upgrade-advisor?current=old-laptop');
    expect(dealStackerLink('test-laptop')).toBe('/tools/deal-stacker?product=test-laptop');
    expect(negotiationLink('test-laptop')).toBe('/tools/negotiation-coach?product=test-laptop');
    expect(repairabilityLink('test-laptop')).toBe('/tools/repairability?product=test-laptop');
    expect(refurbishedLink('test-laptop')).toBe(
      '/tools/refurbished-checklist?product=test-laptop'
    );
    expect(ownItLink('test-laptop')).toBe('/tools/own-it-check?product=test-laptop');
    expect(
      ownItLink(null, { name: 'Test Laptop', brand: 'TestBrand' })
    ).toBe('/tools/own-it-check?name=Test+Laptop&brand=TestBrand');
    // T2/T3 take no product param: their builders carry their own dialect.
    expect(personaFitLink('work', '500')).toBe('/tools/persona-fit?persona=work&budget=500');
    expect(priceMatchLink('offers')).toBe('/tools/price-match?status=offers');
  });

  it('builders with no product return the bare tool route', () => {
    expect(energyCostLink(null)).toBe(TOOL_ROUTES['energy-cost']);
    expect(dealStackerLink(null)).toBe(TOOL_ROUTES['deal-stacker']);
    expect(negotiationLink(null)).toBe(TOOL_ROUTES['negotiation-coach']);
    expect(repairabilityLink(null)).toBe(TOOL_ROUTES.repairability);
    expect(refurbishedLink(null)).toBe(TOOL_ROUTES['refurbished-checklist']);
    expect(ownItLink(null)).toBe(TOOL_ROUTES['own-it-check']);
    expect(compatibilityLink(null)).toBe(TOOL_ROUTES['compatibility-checker']);
    expect(upgradeAdvisorLink(null)).toBe(TOOL_ROUTES['upgrade-advisor']);
    expect(personaFitLink()).toBe(TOOL_ROUTES['persona-fit']);
    expect(priceMatchLink()).toBe(TOOL_ROUTES['price-match']);
  });
});

// ---------------------------------------------------------------------------
// relatedToolLinks — data-only link-block helper
// ---------------------------------------------------------------------------

describe('relatedToolLinks', () => {
  it('returns {href, label} entries carrying the product for every tool', () => {
    const tools = [
      'upgrade-advisor',
      'persona-fit',
      'price-match',
      'own-it-check',
      'energy-cost',
      'negotiation-coach',
      'repairability',
      'deal-stacker',
      'refurbished-checklist',
      'compatibility-checker',
    ] as const;
    for (const tool of tools) {
      const links = relatedToolLinks(tool, 'test-laptop');
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(typeof link.href).toBe('string');
        expect(link.href.length).toBeGreaterThan(0);
        expect(typeof link.label).toBe('string');
        expect(link.label.length).toBeGreaterThan(0);
        // No link points back at the tool itself.
        expect(link.href.startsWith(TOOL_ROUTES[tool])).toBe(false);
      }
      // At least one link carries the product slug (compare links are
      // bare /compare by design — /compare needs UUIDs, not slugs).
      const carrying = links.filter((l) => l.href.includes('test-laptop'));
      expect(carrying.length).toBeGreaterThan(0);
    }
  });

  it('returns no links for an unknown tool', () => {
    expect(relatedToolLinks('not-a-tool', 'test-laptop')).toEqual([]);
    expect(relatedToolLinks('compare', 'test-laptop')).toEqual([]);
  });

  it('works with a null product (bare routes, no empty ?product=)', () => {
    const links = relatedToolLinks('upgrade-advisor', null);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.href).not.toContain('product=');
      expect(link.href).not.toContain('current=');
    }
  });
});
