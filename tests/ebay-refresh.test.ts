import { describe, expect, it } from 'vitest';
import {
  ebayListingMatchesProduct,
  refreshEbayPrices,
  type EbaySearchFn,
} from '@/services/ebay-refresh';
import { getEbayBudgetDateKey } from '@/services/ebay-budget';
import type { EbayListing } from '@/services/ebay-browse';

// Section 15, P1-9 / P3-6 — eBay refresh leg. A generic in-memory
// fake Supabase client (tables as arrays, a thenable query
// builder); synthetic listings only, no network, no database.

type Row = Record<string, unknown>;

class Builder {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ field: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private patch: Row | null = null;
  private insertRow: Row | null = null;
  private mode: 'select' | 'insert' | 'update' = 'select';

  constructor(
    private table: Row[],
    private tableName: string
  ) {}

  select(): this {
    return this;
  }
  eq(field: string, value: unknown): this {
    this.filters.push((r) => r[field] === value);
    return this;
  }
  in(field: string, values: unknown[]): this {
    this.filters.push((r) => values.includes(r[field]));
    return this;
  }
  is(field: string, value: unknown): this {
    this.filters.push((r) => r[field] === value);
    return this;
  }
  lte(field: string, value: unknown): this {
    this.filters.push(
      (r) => typeof r[field] === 'string' && (r[field] as string) <= (value as string)
    );
    return this;
  }
  order(field: string, opts: { ascending: boolean }): this {
    this.orders.push({ field, asc: opts.ascending });
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  insert(row: Row): this {
    this.mode = 'insert';
    this.insertRow = row;
    return this;
  }
  update(patch: Row): this {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }
  not(field: string, op: string, value: unknown): this {
    if (op === 'is') this.filters.push((r) => r[field] !== value);
    return this;
  }

  private run(): Row[] {
    if (this.mode === 'insert' && this.insertRow) {
      const row = { id: `fake-${this.table.length + 1}`, ...this.insertRow };
      this.table.push(row);
      return [row];
    }
    let rows = this.table.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update' && this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
    }
    for (const { field, asc } of this.orders) {
      rows = [...rows].sort((a, b) => {
        const av = String(a[field] ?? '');
        const bv = String(b[field] ?? '');
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : av > bv ? -1 : av < bv ? 1 : 0;
      });
    }
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }
  async single(): Promise<{ data: Row | null; error: null }> {
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.run(), error: null }).then(
      onfulfilled,
      onrejected
    );
  }
}

function fakeSupabase(seed: {
  merchants?: Row[];
  products?: Row[];
  merchantProducts?: Row[];
  usageCalls?: number | null;
}) {
  const tables: Record<string, Row[]> = {
    merchants: seed.merchants ?? [{ id: 'm-ebay', slug: 'ebay', name: 'eBay' }],
    currencies: [
      { id: 'cur-usd', code: 'USD' },
      { id: 'cur-eur', code: 'EUR' },
    ],
    products: seed.products ?? [
      {
        id: 'p-macbook',
        name: 'MacBook Air 13',
        slug: 'macbook-air-13',
        brand: 'Apple',
        refresh_priority: 3,
        refresh_status: 'idle',
        next_refresh_at: '2026-11-01T00:00:00.000Z',
        data_freshness: '2026-11-02T07:13:52.000Z',
        deleted_at: null,
      },
    ],
    merchant_products: seed.merchantProducts ?? [],
    ebay_daily_usage:
      seed.usageCalls === undefined || seed.usageCalls === null
        ? []
        : [{ usage_date: getEbayBudgetDateKey(new Date()), calls: seed.usageCalls }],
  };
  const client = {
    tables,
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      return {
        select: () => new Builder(rows, table),
        insert: (row: Row) => new Builder(rows, table).insert(row),
        update: (patch: Row) => new Builder(rows, table).update(patch),
      };
    },
  };
  return client;
}

function fakeListing(overrides: Partial<EbayListing> = {}): EbayListing {
  return {
    itemId: 'v1|ebay-1|0',
    title: 'Apple MacBook Air 13 inch Laptop M2 8GB 256GB',
    price: 899,
    currency: 'USD',
    condition: 'New',
    itemWebUrl: 'https://www.ebay.com/itm/ebay-1',
    imageUrl: null,
    ...overrides,
  };
}

describe('ebayListingMatchesProduct', () => {
  it('matches when every name + brand token is in the title', () => {
    expect(
      ebayListingMatchesProduct(
        'MacBook Air 13',
        'Apple',
        'Apple MacBook Air 13 inch Laptop M2 8GB 256GB'
      )
    ).toBe(true);
  });

  it('rejects when a name token is missing', () => {
    expect(
      ebayListingMatchesProduct('MacBook Air 13', 'Apple', 'Apple MacBook Pro 14 Laptop')
    ).toBe(false);
  });

  it('rejects when the brand token is missing', () => {
    expect(
      ebayListingMatchesProduct('MacBook Air 13', 'Apple', 'MacBook Air 13 Laptop')
    ).toBe(false);
  });

  it('rejects accessories, never records a case as a laptop price', () => {
    expect(
      ebayListingMatchesProduct(
        'MacBook Air 13',
        'Apple',
        'Apple MacBook Air 13 laptop case cover'
      )
    ).toBe(false);
    expect(
      ebayListingMatchesProduct(
        'Sony WH-1000XM5',
        'Sony',
        'Sony WH-1000XM5 replacement battery'
      )
    ).toBe(false);
  });
});

describe('refreshEbayPrices', () => {
  it('fails honestly with merchant-missing when the eBay merchants row is absent', async () => {
    const db = fakeSupabase({ merchants: [] });
    const searchFn: EbaySearchFn = async () => {
      throw new Error('search must not run without a merchant row');
    };
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn }
    );
    expect(result.status).toBe('merchant-missing');
    expect(result.checked).toBe(0);
    expect(result.error).toContain('never auto-created');
  });

  it('matches, inserts the eBay row and stamps data_freshness', async () => {
    const db = fakeSupabase({});
    const searchFn: EbaySearchFn = async () => ({
      ok: true,
      source: 'ebay-browse-api',
      listings: [fakeListing()],
    });
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result.status).toBe('ok');
    expect(result).toMatchObject({ checked: 1, inserted: 1, updated: 0 });
    expect(result.products[0]).toMatchObject({
      slug: 'macbook-air-13',
      outcome: 'inserted',
      price: 899,
      currency: 'USD',
    });
    // One eBay merchant_products row, with the durable itemId key.
    expect(db.tables.merchant_products).toHaveLength(1);
    expect(db.tables.merchant_products[0]).toMatchObject({
      product_id: 'p-macbook',
      merchant_id: 'm-ebay',
      price: 899,
      merchant_sku: 'v1|ebay-1|0',
      url: 'https://www.ebay.com/itm/ebay-1',
    });
    // P1-10: the live check stamps freshness through the policy layer.
    expect(db.tables.products[0].data_freshness).not.toBe('2026-11-02T07:13:52.000Z');
    expect(db.tables.products[0].refresh_status).toBe('idle');
  });

  it('updates the existing eBay row on the next check', async () => {
    const db = fakeSupabase({
      merchantProducts: [
        {
          id: 'mp-1',
          product_id: 'p-macbook',
          merchant_id: 'm-ebay',
          price: 950,
          currency_id: 'cur-usd',
          merchant_sku: 'v1|old|0',
          url: 'https://www.ebay.com/itm/old',
          in_stock: true,
        },
      ],
    });
    const searchFn: EbaySearchFn = async () => ({
      ok: true,
      source: 'ebay-browse-api',
      listings: [fakeListing({ price: 899, itemId: 'v1|ebay-1|0' })],
    });
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result).toMatchObject({ checked: 1, updated: 1, inserted: 0 });
    expect(db.tables.merchant_products).toHaveLength(1);
    expect(db.tables.merchant_products[0]).toMatchObject({
      price: 899,
      merchant_sku: 'v1|ebay-1|0',
    });
  });

  it('skips a mismatch and records no price', async () => {
    const db = fakeSupabase({});
    const searchFn: EbaySearchFn = async () => ({
      ok: true,
      source: 'ebay-browse-api',
      listings: [
        fakeListing({ title: 'Apple MacBook Pro 14 Laptop', itemId: 'v1|other|0' }),
      ],
    });
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result).toMatchObject({ checked: 1, skippedMismatch: 1, inserted: 0 });
    expect(db.tables.merchant_products).toHaveLength(0);
  });

  it('counts zero listings as skipped-no-listing', async () => {
    const db = fakeSupabase({});
    const searchFn: EbaySearchFn = async () => ({
      ok: true,
      source: 'ebay-browse-api',
      listings: [],
    });
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result).toMatchObject({ skippedNoListing: 1 });
  });

  it('skips a listing with an unknown currency', async () => {
    const db = fakeSupabase({});
    const searchFn: EbaySearchFn = async () => ({
      ok: true,
      source: 'ebay-browse-api',
      listings: [fakeListing({ currency: 'XXX' })],
    });
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result).toMatchObject({ skippedUnknownCurrency: 1, inserted: 0 });
  });

  it('stops the run as not-configured without failing it', async () => {
    const db = fakeSupabase({});
    const searchFn: EbaySearchFn = async () => ({
      ok: false,
      reason: 'not-configured',
      listings: [],
    });
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result.status).toBe('not-configured');
    expect(result.checked).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('retries a transient rate-limit and then succeeds', async () => {
    const db = fakeSupabase({});
    let calls = 0;
    const searchFn: EbaySearchFn = async () => {
      calls += 1;
      if (calls < 3) return { ok: false, reason: 'rate-limited', listings: [] };
      return { ok: true, source: 'ebay-browse-api', listings: [fakeListing()] };
    };
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(calls).toBe(3);
    expect(result).toMatchObject({ inserted: 1, failed: 0 });
  });

  it('stops with budget-exhausted when the daily cap is reached', async () => {
    const db = fakeSupabase({ usageCalls: 4500 });
    let calls = 0;
    const searchFn: EbaySearchFn = async () => {
      calls += 1;
      return { ok: true, source: 'ebay-browse-api', listings: [fakeListing()] };
    };
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result.budgetExhausted).toBe(true);
    expect(result.status).toBe('budget-exhausted');
    expect(calls).toBe(0);
    expect(result.inserted).toBe(0);
  });

  it('checks nothing when no product is due', async () => {
    const db = fakeSupabase({
      products: [
        {
          id: 'p-macbook',
          name: 'MacBook Air 13',
          slug: 'macbook-air-13',
          brand: 'Apple',
          refresh_priority: 3,
          refresh_status: 'idle',
          next_refresh_at: '2027-01-01T00:00:00.000Z',
          data_freshness: '2026-11-02T07:13:52.000Z',
          deleted_at: null,
        },
      ],
    });
    let calls = 0;
    const searchFn: EbaySearchFn = async () => {
      calls += 1;
      return { ok: true, source: 'ebay-browse-api', listings: [fakeListing()] };
    };
    const result = await refreshEbayPrices(
      db as unknown as Parameters<typeof refreshEbayPrices>[0],
      { searchFn, noRetryDelay: true }
    );
    expect(result.checked).toBe(0);
    expect(calls).toBe(0);
  });
});
