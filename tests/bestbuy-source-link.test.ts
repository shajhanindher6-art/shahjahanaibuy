import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  linkBestBuySources,
  BESTBUY_SOURCE_LINK_BATCH_LIMIT,
  type BestBuySourceSearch,
} from '@/services/bestbuy-source-link';
import type { RawProductData } from '@/services/providers/types';
import { resetProviderBudgets } from '@/services/provider-budget';

// Post-Integration Verification & Real Data Phase — Best Buy
// source-linking step. Fake Supabase (tables as arrays, a
// thenable query builder — same pattern as
// tests/ebay-refresh.test.ts) + a fake provider. No network, no
// database, no real key: the provider fake never reads env.

type Row = Record<string, unknown>;

interface FakeOpts {
  /** products.model_number does not exist yet (migration 055 unapplied). */
  modelNumberMissing?: boolean;
  /** products.status does not exist yet (migration 045 unapplied). */
  statusColumnMissing?: boolean;
  /** product_sources.last_fetched_at is NOT NULL (migration 073 unapplied). */
  nullableLastFetched?: boolean;
}

class Builder {
  private filters: Array<(row: Row) => boolean> = [];
  private eqFields: Set<string> = new Set();
  private limitN: number | null = null;
  private orderField: string | null = null;
  private orderAsc = true;
  private mode: 'select' | 'upsert' = 'select';
  private upsertRow: Row | null = null;
  private upsertConflict: string | null = null;
  private singleMode: 'maybeSingle' | 'single' | null = null;
  private selectCols: string | null = null;

  constructor(
    private table: Row[],
    private tableName: string,
    private opts: FakeOpts
  ) {}

  select(cols?: string): this {
    this.selectCols = cols ?? null;
    return this;
  }
  eq(field: string, value: unknown): this {
    this.eqFields.add(field);
    this.filters.push((r) => r[field] === value);
    return this;
  }
  in(field: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[field]));
    return this;
  }
  is(field: string, value: unknown): this {
    this.filters.push((r) => (value === null ? r[field] == null : r[field] === value));
    return this;
  }
  lte(field: string, value: unknown): this {
    this.filters.push(
      (r) => typeof r[field] === 'string' && (r[field] as string) <= (value as string)
    );
    return this;
  }
  order(field: string, opts: { ascending: boolean }): this {
    this.orderField = field;
    this.orderAsc = opts.ascending;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  maybeSingle(): this {
    this.singleMode = 'maybeSingle';
    return this;
  }
  single(): this {
    this.singleMode = 'single';
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }): this {
    this.mode = 'upsert';
    this.upsertRow = row;
    this.upsertConflict = opts?.onConflict ?? null;
    return this;
  }
  insert(row: Row): this {
    this.mode = 'upsert';
    this.upsertRow = row;
    return this;
  }
  update(patch: Row): this {
    this.mode = 'upsert';
    this.upsertRow = patch;
    return this;
  }

  private run(): { data: Row[] | Row | null; error: { code?: string; message: string } | null } {
    // Simulated missing columns (42703).
    if (this.tableName === 'products' && this.selectCols?.includes('model_number') && this.opts.modelNumberMissing) {
      return { data: null, error: { code: '42703', message: 'column "model_number" does not exist' } };
    }
    if (
      this.tableName === 'products' &&
      this.opts.statusColumnMissing &&
      this.eqFields.has('status')
    ) {
      return { data: null, error: { code: '42703', message: 'column "status" does not exist' } };
    }
    if (this.mode === 'upsert' && this.upsertRow) {
      if (
        this.tableName === 'product_sources' &&
        this.upsertRow.last_fetched_at === null &&
        this.opts.nullableLastFetched === false
      ) {
        return {
          data: null,
          error: { code: '23502', message: 'null value in column "last_fetched_at" violates not-null constraint' },
        };
      }
      const row: Row = { id: `fake-${this.table.length + 1}`, ...this.upsertRow };
      if (this.upsertConflict) {
        const [a, b] = this.upsertConflict.split(',');
        const idx = this.table.findIndex((r) => r[a] === row[a] && r[b] === row[b]);
        if (idx >= 0) {
          this.table[idx] = { ...this.table[idx], ...row };
          return { data: [this.table[idx]], error: null };
        }
      }
      this.table.push(row);
      return { data: [row], error: null };
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderField) {
      const field = this.orderField;
      rows = [...rows].sort((x, y) => {
        const a = String(x[field] ?? '');
        const b = String(y[field] ?? '');
        return this.orderAsc ? a.localeCompare(b) : b.localeCompare(a);
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    if (this.singleMode === 'maybeSingle') {
      return { data: rows[0] ?? null, error: null };
    }
    if (this.singleMode === 'single') {
      return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows' } };
    }
    return { data: rows, error: null };
  }

  then(
    resolve: (value: { data: Row[] | Row | null; error: { code?: string; message: string } | null }) => void,
    reject?: (err: unknown) => void
  ): void {
    try {
      resolve(this.run());
    } catch (err) {
      if (reject) reject(err);
      else throw err;
    }
  }
}

function makeClient(tables: Record<string, Row[]>, opts: FakeOpts = {}) {
  return {
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      return new Builder(rows, table, opts);
    },
  };
}

function candidate(overrides: Partial<RawProductData> = {}): RawProductData {
  return {
    externalId: '6413523',
    retailerSlug: 'bestbuy',
    name: 'Samsung Galaxy S24 Ultra 256GB (Unlocked) - Titanium Black',
    brand: 'Samsung',
    gtin: '036000291452',
    modelNumber: 'SM-S928UZKAXAA',
    price: 1199.99,
    currency: 'USD',
    availability: 'in_stock',
    ...overrides,
  };
}

class FakeProvider implements BestBuySourceSearch {
  calls: string[] = [];
  constructor(
    private opts: {
      available?: boolean;
      byUpc?: Map<string, RawProductData[]>;
      byModel?: Map<string, RawProductData[]>;
      byQuery?: Map<string, RawProductData[]>;
      throwOnSearch?: boolean;
    } = {}
  ) {}

  isAvailable(): boolean {
    return this.opts.available ?? true;
  }
  getNotConfiguredReason(): string | null {
    return this.isAvailable() ? null : 'Best Buy has no live price integration: no API key is configured (test).';
  }
  async searchByUpc(upc: string): Promise<RawProductData[]> {
    this.calls.push(`upc:${upc}`);
    return this.opts.byUpc?.get(upc) ?? [];
  }
  async searchByModel(modelNumber: string): Promise<RawProductData[]> {
    this.calls.push(`model:${modelNumber}`);
    return this.opts.byModel?.get(modelNumber) ?? [];
  }
  async search(request: { query: string }): Promise<RawProductData[]> {
    this.calls.push(`query:${request.query}`);
    if (this.opts.throwOnSearch) throw new Error('provider exploded (test)');
    return this.opts.byQuery?.get(request.query) ?? [];
  }
}

const RETAILER = { id: 'r-bestbuy', slug: 'best-buy', name: 'Best Buy', country: 'US' };

function product(overrides: Partial<Row> = {}): Row {
  return {
    id: 'p-s24',
    slug: 'galaxy-s24-ultra',
    name: 'Galaxy S24 Ultra',
    brand: 'Samsung',
    gtin: null,
    deleted_at: null,
    status: 'published',
    next_refresh_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  resetProviderBudgets();
  delete process.env.PROVIDER_DAILY_BUDGET_BESTBUY;
});

afterEach(() => {
  resetProviderBudgets();
  delete process.env.PROVIDER_DAILY_BUDGET_BESTBUY;
});

describe('linkBestBuySources — not-configured / retailer-missing', () => {
  it('returns not-configured without a key and searches nothing', async () => {
    const provider = new FakeProvider({ available: false });
    const client = makeClient({ retailers: [RETAILER], products: [product()], product_sources: [] });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('not-configured');
    expect(result.checked).toBe(0);
    expect(provider.calls).toEqual([]);
  });

  it('returns retailer-missing when the best-buy retailers row is absent', async () => {
    const provider = new FakeProvider();
    const client = makeClient({ retailers: [], products: [product()], product_sources: [] });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('retailer-missing');
    expect(result.checked).toBe(0);
    expect(provider.calls).toEqual([]);
  });
});

describe('linkBestBuySources — linking', () => {
  it('links a product on a keyword auto-match and writes a NULL last_fetched_at', async () => {
    const provider = new FakeProvider({
      byQuery: new Map([['Galaxy S24 Ultra', [candidate()]]]),
    });
    const sources: Row[] = [];
    const client = makeClient({ retailers: [RETAILER], products: [product()], product_sources: sources });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('ok');
    expect(result.linked).toBe(1);
    expect(result.products[0].outcome).toBe('linked');
    expect(result.products[0].sku).toBe('6413523');
    expect(result.products[0].matchConfidence).toBe(1);
    expect(result.products[0].matchedBy).toBe('name-brand');
    expect(sources).toHaveLength(1);
    expect(sources[0].product_id).toBe('p-s24');
    expect(sources[0].retailer_id).toBe('r-bestbuy');
    expect(sources[0].external_id).toBe('6413523');
    expect(sources[0].provider_key).toBe('bestbuy');
    expect(sources[0].last_fetched_at).toBeNull();
    expect(result.products[0].fetchTimestampAssumed).toBeUndefined();
  });

  it('searches by UPC first when the product carries a valid GTIN', async () => {
    const provider = new FakeProvider({
      byUpc: new Map([['036000291452', [candidate()]]]),
      byQuery: new Map([['Galaxy S24 Ultra', [candidate({ externalId: '9999999' })]]]),
    });
    const sources: Row[] = [];
    const client = makeClient({
      retailers: [RETAILER],
      products: [product({ gtin: '036000291452' })],
      product_sources: sources,
    });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.linked).toBe(1);
    expect(result.products[0].sku).toBe('6413523');
    expect(provider.calls).toEqual(['upc:036000291452']);
  });

  it('falls back to model search when the UPC search is empty', async () => {
    const provider = new FakeProvider({
      byUpc: new Map(),
      byModel: new Map([['SM-S928UZKAXAA', [candidate()]]]),
    });
    const sources: Row[] = [];
    const client = makeClient({
      retailers: [RETAILER],
      products: [product({ gtin: '036000291452', model_number: 'SM-S928UZKAXAA' })],
      product_sources: sources,
    });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.linked).toBe(1);
    expect(provider.calls).toEqual(['upc:036000291452', 'model:SM-S928UZKAXAA']);
  });

  it('skips an already-linked product without spending budget', async () => {
    const provider = new FakeProvider({
      byQuery: new Map([['Galaxy S24 Ultra', [candidate()]]]),
    });
    const sources: Row[] = [
      { id: 's-1', product_id: 'p-s24', retailer_id: 'r-bestbuy', external_id: '6413523', provider_key: 'bestbuy' },
    ];
    const client = makeClient({ retailers: [RETAILER], products: [product()], product_sources: sources });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('ok');
    expect(result.alreadyLinked).toBe(1);
    expect(result.linked).toBe(0);
    expect(provider.calls).toEqual([]);
    expect(sources).toHaveLength(1);
  });

  it('holds a below-threshold match for review and links nothing', async () => {
    // Brand null + 4/5 name tokens covered → score 0.8 < 0.85 → review.
    const provider = new FakeProvider({
      byQuery: new Map([['Logitech MX Master 3S Mouse', [candidate({ name: 'Logitech MX Master 3S', brand: undefined })]]]),
    });
    const sources: Row[] = [];
    const client = makeClient({
      retailers: [RETAILER],
      products: [product({ id: 'p-mx', slug: 'logitech-mx-master-3s', name: 'Logitech MX Master 3S Mouse', brand: null })],
      product_sources: sources,
    });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.linked).toBe(0);
    expect(result.skippedReview).toBe(1);
    expect(result.products[0].outcome).toBe('skipped-review');
    expect(result.products[0].matchReviewRequired).toBe(true);
    expect(result.products[0].matchConfidence).toBeCloseTo(0.8, 5);
    expect(sources).toHaveLength(0);
  });

  it('vetoes a GTIN mismatch and links nothing', async () => {
    const provider = new FakeProvider({
      byUpc: new Map([['036000291452', [candidate({ gtin: '012345678905' })]]]),
    });
    const sources: Row[] = [];
    const client = makeClient({
      retailers: [RETAILER],
      products: [product({ gtin: '036000291452' })],
      product_sources: sources,
    });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.linked).toBe(0);
    expect(result.skippedReview).toBe(1);
    expect(result.products[0].matchConfidence).toBeNull();
    expect(sources).toHaveLength(0);
  });

  it('vetoes a model conflict and links nothing', async () => {
    const provider = new FakeProvider({
      byQuery: new Map([
        [
          'Galaxy S24 Ultra',
          [candidate({ modelNumber: 'SM-S928C' })],
        ],
      ]),
    });
    const sources: Row[] = [];
    const client = makeClient({
      retailers: [RETAILER],
      products: [product({ model_number: 'SM-S928B' })],
      product_sources: sources,
    });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.linked).toBe(0);
    expect(result.skippedReview).toBe(1);
    expect(sources).toHaveLength(0);
  });

  it('skips with no-match when every leg returns nothing', async () => {
    const provider = new FakeProvider();
    const sources: Row[] = [];
    const client = makeClient({ retailers: [RETAILER], products: [product()], product_sources: sources });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.linked).toBe(0);
    expect(result.skippedNoMatch).toBe(1);
    expect(result.products[0].outcome).toBe('skipped-no-match');
    expect(sources).toHaveLength(0);
  });

  it('fails one product on a provider throw and continues with the rest', async () => {
    const provider = new FakeProvider({ throwOnSearch: true });
    const sources: Row[] = [];
    const client = makeClient({
      retailers: [RETAILER],
      products: [
        product(),
        product({ id: 'p-sony', slug: 'sony-wh-1000xm5', name: 'Sony WH-1000XM5', brand: 'Sony' }),
      ],
      product_sources: sources,
    });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('ok');
    expect(result.failed).toBe(2);
    expect(result.products.map((p) => p.outcome)).toEqual(['failed', 'failed']);
  });
});

describe('linkBestBuySources — budget and migration fallbacks', () => {
  it('stops with budget-exhausted when the daily cap is 0', async () => {
    process.env.PROVIDER_DAILY_BUDGET_BESTBUY = '0';
    const provider = new FakeProvider({
      byQuery: new Map([['Galaxy S24 Ultra', [candidate()]]]),
    });
    const sources: Row[] = [];
    const client = makeClient({ retailers: [RETAILER], products: [product()], product_sources: sources });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('budget-exhausted');
    expect(result.budgetExhausted).toBe(true);
    expect(result.linked).toBe(0);
    expect(provider.calls).toEqual([]);
  });

  it('stamps the link time and reports the assumption when 073 is unapplied (23502)', async () => {
    const provider = new FakeProvider({
      byQuery: new Map([['Galaxy S24 Ultra', [candidate()]]]),
    });
    const sources: Row[] = [];
    const client = makeClient(
      { retailers: [RETAILER], products: [product()], product_sources: sources },
      { nullableLastFetched: false }
    );
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.linked).toBe(1);
    expect(result.products[0].fetchTimestampAssumed).toBe(true);
    expect(sources).toHaveLength(1);
    expect(typeof sources[0].last_fetched_at).toBe('string');
  });

  it('still links when model_number is missing (055 unapplied)', async () => {
    const provider = new FakeProvider({
      byQuery: new Map([['Galaxy S24 Ultra', [candidate()]]]),
    });
    const sources: Row[] = [];
    const client = makeClient(
      { retailers: [RETAILER], products: [product()], product_sources: sources },
      { modelNumberMissing: true }
    );
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('ok');
    expect(result.linked).toBe(1);
  });

  it('still links when the status column is missing (045 unapplied)', async () => {
    const provider = new FakeProvider({
      byQuery: new Map([['Galaxy S24 Ultra', [candidate()]]]),
    });
    const sources: Row[] = [];
    const client = makeClient(
      { retailers: [RETAILER], products: [product()], product_sources: sources },
      { statusColumnMissing: true }
    );
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.status).toBe('ok');
    expect(result.linked).toBe(1);
  });

  it('caps the run at the batch limit', async () => {
    expect(BESTBUY_SOURCE_LINK_BATCH_LIMIT).toBe(10);
    const many = Array.from({ length: 12 }, (_, i) =>
      product({ id: `p-${i}`, slug: `product-${i}`, name: `Product ${i}`, brand: null })
    );
    const provider = new FakeProvider();
    const sources: Row[] = [];
    const client = makeClient({ retailers: [RETAILER], products: many, product_sources: sources });
    const result = await linkBestBuySources(client as never, { provider });
    expect(result.checked).toBe(10);
  });
});
