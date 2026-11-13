import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getProviderRegistry,
  resetProviderRegistry,
} from '@/services/providers/registry';
import { CsvProvider } from '@/services/providers/csv-provider';
import { AmazonProvider } from '@/services/providers/amazon-provider';
import { BestBuyProvider } from '@/services/providers/bestbuy-provider';
import { ApifyProvider } from '@/services/providers/apify-provider';
import { ensureCsvDataSource } from '@/services/data-sources';
import {
  refreshEbayPrices,
  type EbaySearchFn,
} from '@/services/ebay-refresh';
import type { EbayListing } from '@/services/ebay-browse';
import { sendGenericWebhook } from '@/lib/generic-webhook';
import type { AnySupabaseClient } from '@/lib/supabase/types';
import { maxDuration as uptimeCheckMaxDuration } from '@/app/api/v1/monitoring/uptime/check/route';

// Section 20 — merchant integration layer (audit §12 #25, #52, #53,
// #57, #58, #95, #96, #99, #38, #54, #55). Synthetic data only:
// no network, no database, no secrets. Where a test needs a URL
// that passes the SSRF guard it uses a literal public IP
// (8.8.8.8) — the sandbox DNS sinkholes hostnames to the
// 198.18 benchmarking range, which the guard correctly rejects,
// so example.com URLs must never be used as "public" fixtures.

function readSource(path: string): string {
  return readFileSync(`${process.cwd()}/${path}`, 'utf8');
}

// ---------------------------------------------------------------------------
// Minimal in-memory fake Supabase client (tables as arrays, a thenable
// query builder), modelled on tests/ebay-refresh.test.ts. Supports
// select/insert/update/upsert + eq/in/is/lte/order/limit +
// maybeSingle/single. `failStampedWrites` answers 42703 to any write
// whose payload carries the migration-045 stamp columns;
// `failWrites` fails every write (non-42703) instead.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryError = { code?: string; message: string } | null;

class FakeBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ field: string; asc: boolean }> = [];
  private limitN: number | null = null;
  private patch: Row | null = null;
  private insertRow: Row | null = null;
  private upsertRow: Row | null = null;
  private upsertConflict: string | null = null;
  private mode: 'select' | 'insert' | 'update' | 'upsert' = 'select';

  constructor(
    private table: Row[],
    private failStampedWrites: boolean,
    private failWrites: boolean
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
  upsert(row: Row, options?: { onConflict?: string }): this {
    this.mode = 'upsert';
    this.upsertRow = row;
    this.upsertConflict = options?.onConflict ?? null;
    return this;
  }

  private writeError(): QueryError {
    const payload =
      this.mode === 'insert'
        ? this.insertRow
        : this.mode === 'update'
          ? this.patch
          : this.mode === 'upsert'
            ? this.upsertRow
            : null;
    if (!payload) return null;
    if (this.failWrites) return { code: '23505', message: 'simulated write failure' };
    if (this.failStampedWrites && 'price_verification_status' in payload) {
      return {
        code: '42703',
        message: 'column "price_verification_status" does not exist',
      };
    }
    return null;
  }

  private run(): Row[] {
    if (this.mode === 'insert' && this.insertRow) {
      const row = { id: `fake-${this.table.length + 1}`, ...this.insertRow };
      this.table.push(row);
      return [row];
    }
    if (this.mode === 'upsert' && this.upsertRow) {
      const key = this.upsertConflict;
      if (key) {
        const existing = this.table.find((r) => r[key] === this.upsertRow![key]);
        if (existing) {
          Object.assign(existing, this.upsertRow);
          return [existing];
        }
      }
      const row = { id: `fake-${this.table.length + 1}`, ...this.upsertRow };
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
    return { data: this.run()[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: QueryError }> {
    const err = this.writeError();
    if (err) return { data: null, error: err };
    return { data: this.run()[0] ?? null, error: null };
  }

  then<
    TResult1 = { data: Row[] | null; error: QueryError },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: QueryError }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const err = this.writeError();
    const value =
      err != null
        ? { data: null, error: err }
        : { data: this.run(), error: null };
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(
  seed: {
    merchants?: Row[];
    products?: Row[];
    merchantProducts?: Row[];
    providers?: Row[];
    dataSources?: Row[];
  },
  opts: { failStampedWrites?: boolean; failWrites?: boolean } = {}
) {
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
    ebay_daily_usage: [],
    provider_health: [],
    error_log: [],
    providers: seed.providers ?? [],
    data_sources: seed.dataSources ?? [],
  };
  const client = {
    tables,
    from(table: string) {
      const rows = tables[table];
      if (!rows) throw new Error(`unexpected table ${table}`);
      const builder = () => new FakeBuilder(rows, opts.failStampedWrites ?? false, opts.failWrites ?? false);
      return {
        select: () => builder(),
        insert: (row: Row) => builder().insert(row),
        update: (patch: Row) => builder().update(patch),
        upsert: (row: Row, options?: { onConflict?: string }) =>
          builder().upsert(row, options),
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
    // EbayListing.gtin is required `string | null` (S21 B12) —
    // an override that sets it to undefined must not leak through.
    gtin: overrides.gtin ?? null,
  };
}

const matchingSearchFn: EbaySearchFn = async () => ({
  ok: true,
  source: 'ebay-browse-api',
  listings: [fakeListing()],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetProviderRegistry();
});

describe('provider registry — CSV / Amazon / Best Buy registration (#57, #58)', () => {
  const savedCsvUrl = process.env.CSV_SOURCE_URL;

  beforeEach(() => {
    delete process.env.CSV_SOURCE_URL;
    delete process.env.AMAZON_CREATORS_API_KEY;
    delete process.env.BESTBUY_API_KEY;
    delete process.env.APIFY_API_TOKEN;
    delete process.env.APIFY_ACTOR_ID;
    resetProviderRegistry();
  });

  afterEach(() => {
    resetProviderRegistry();
    if (savedCsvUrl !== undefined) process.env.CSV_SOURCE_URL = savedCsvUrl;
    else delete process.env.CSV_SOURCE_URL;
    delete process.env.AMAZON_CREATORS_API_KEY;
    delete process.env.BESTBUY_API_KEY;
  });

  it('registers csv, amazon and bestbuy alongside apify', () => {
    const registry = getProviderRegistry();
    expect(registry.get('csv')?.key).toBe('csv');
    expect(registry.get('csv')?.category).toBe('csv_import');
    expect(registry.get('amazon')?.key).toBe('amazon');
    expect(registry.get('bestbuy')?.key).toBe('bestbuy');
    expect(registry.get('apify')?.key).toBe('apify');
  });

  it('none of csv / amazon / bestbuy is available without its config', () => {
    const registry = getProviderRegistry();
    expect(registry.get('csv')?.isAvailable()).toBe(false);
    expect(registry.get('amazon')?.isAvailable()).toBe(false);
    expect(registry.get('bestbuy')?.isAvailable()).toBe(false);
    const available = registry.getAvailable().map((p) => p.key);
    expect(available).not.toContain('csv');
    expect(available).not.toContain('amazon');
    expect(available).not.toContain('bestbuy');
    expect(available).not.toContain('apify');
  });

  it('csv becomes available when CSV_SOURCE_URL is set', () => {
    process.env.CSV_SOURCE_URL = 'https://8.8.8.8/feed.csv';
    resetProviderRegistry();
    const registry = getProviderRegistry();
    expect(registry.get('csv')?.isAvailable()).toBe(true);
    expect(registry.getAvailable().map((p) => p.key)).toContain('csv');
  });

  it('amazon / bestbuy explain honestly why they cannot fetch', () => {
    expect(new AmazonProvider().getNotConfiguredReason()).toMatch(/retired/i);
    expect(new AmazonProvider().getNotConfiguredReason()).toMatch(/Creators API/);
    expect(new BestBuyProvider().getNotConfiguredReason()).toMatch(/no API key is configured/i);
  });

  it('amazon / bestbuy search and fetch throw NOT_CONFIGURED, never fake rows', async () => {
    // Sections 21–25, Stage B (B1) — was a silent [] / null, which
    // callers read as "checked, no results". There is no client, so
    // a search is not a search: it throws a typed error naming why.
    await expect(new AmazonProvider().search({ query: 'laptop' })).rejects.toThrow(
      /no live price integration/
    );
    await expect(
      new AmazonProvider().fetch({ externalId: 'x', retailerSlug: 'amazon' })
    ).rejects.toThrow(/no live price integration/);
    await expect(new BestBuyProvider().search({ query: 'laptop' })).rejects.toThrow(
      /no live price integration/
    );
    await expect(
      new BestBuyProvider().fetch({ externalId: 'x', retailerSlug: 'bestbuy' })
    ).rejects.toThrow(/no live price integration/);
  });

  it('amazon is available-gated on its key (stub: still no client)', async () => {
    process.env.AMAZON_CREATORS_API_KEY = 'test-key';
    expect(new AmazonProvider().isAvailable()).toBe(true);
    // A set key must never be read as "live": no client exists yet.
    await expect(new AmazonProvider().search({ query: 'laptop' })).rejects.toThrow(
      /no .* client exists yet/
    );
  });

  it('bestbuy is available-gated on its key and a set key means a real client', async () => {
    // Final Real Data Completion — the Best Buy client exists now:
    // a set key makes the provider available with no
    // not-configured reason, and search() performs a real call
    // (mocked here to 403 — a bad key / over-limit answer — so
    // the test never touches the network).
    process.env.BESTBUY_API_KEY = 'test-key';
    const provider = new BestBuyProvider();
    expect(provider.isAvailable()).toBe(true);
    expect(provider.getNotConfiguredReason()).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"forbidden"}', { status: 403 }))
    );
    await expect(provider.search({ query: 'laptop' })).rejects.toThrow(/HTTP 403/);
  });
});

describe('CsvProvider (#58, #99)', () => {
  const csv = 'name,price,currency,retailer\nexample phone,199,USD,amazon\n';

  it('isAvailable() is false with no source configured', () => {
    expect(new CsvProvider({}).isAvailable()).toBe(false);
    expect(new CsvProvider({ csvUrl: '  ' }).isAvailable()).toBe(false);
  });

  it('searches inline CSV data without fetching', async () => {
    const provider = new CsvProvider({ csv });
    const results = await provider.search({ query: 'phone' });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('example phone');
    expect(results[0]?.price).toBe(199);
    expect(await provider.fetch({ externalId: results[0]!.externalId, retailerSlug: 'amazon' })).not.toBeNull();
  });

  it('fetches a public-IP CSV URL', async () => {
    const fetchSpy = vi.fn(async () => new Response(csv, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new CsvProvider({ csvUrl: 'https://8.8.8.8/feed.csv' });
    expect(provider.isAvailable()).toBe(true);
    const results = await provider.search({ query: 'phone' });
    expect(results).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses a private CSV URL before any fetch (SSRF guard)', async () => {
    const fetchSpy = vi.fn(async () => new Response(csv, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new CsvProvider({ csvUrl: 'http://127.0.0.1/feed.csv' });
    // Sections 21–25, Stage B (B1 + B6) — was a silent [], cached
    // as a successful empty parse. A refused fetch now throws a
    // typed error, so no caller can read it as "feed checked".
    await expect(provider.search({ query: 'phone' })).rejects.toThrow(/SSRF/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('ApifyProvider token transport (#99)', () => {
  const savedToken = process.env.APIFY_API_TOKEN;
  const savedActorId = process.env.APIFY_ACTOR_ID;

  beforeEach(() => {
    process.env.APIFY_API_TOKEN = 'tok-123';
    process.env.APIFY_ACTOR_ID = 'actor-1';
  });

  afterEach(() => {
    if (savedToken !== undefined) process.env.APIFY_API_TOKEN = savedToken;
    else delete process.env.APIFY_API_TOKEN;
    if (savedActorId !== undefined) process.env.APIFY_ACTOR_ID = savedActorId;
    else delete process.env.APIFY_ACTOR_ID;
  });

  it('kill-switch (Final 100%, F-P1-59): vars set still means unavailable — no request is ever made', async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      })
    );
    const provider = new ApifyProvider();
    // The ban is code, not env: setting the vars must NOT activate it.
    expect(provider.isAvailable()).toBe(false);
    await expect(provider.search({ query: 'phone' })).rejects.toThrow(/Apify is rejected/);
    // No request at all — so the token can never leak into a URL
    // (the old #99 guarantee, now vacuous by construction: the
    // provider throws before any fetch).
    expect(fetchCalls).toBe(0);
  });

  it('the provider source never interpolates the token into a URL (#99)', () => {
    // The literal `?token=` appears only in the explanatory comment
    // at the Authorization-header call site (describing what NOT to
    // do); the real guarantee is that the token is interpolated
    // exactly once, on the Authorization header line, never into a
    // URL. The behavioural test above proves no request is made at
    // all under the kill-switch, so the token cannot leak anywhere.
    const src = readSource('services/providers/apify-provider.ts');
    const tokenUses = src.split('\n').filter((line) => line.includes('${this.token}'));
    expect(tokenUses).toHaveLength(1);
    expect(tokenUses[0]).toContain('Authorization');
    expect(src).not.toContain('?token=${');
    expect(src).not.toContain("searchParams.set('token'");
  });
});

describe('eBay refresh verification stamp + provider health (#25, #52)', () => {
  it('stamps verified / ebay-browse-api / verified_at / last_synced_at on insert', async () => {
    const db = fakeSupabase({});
    const result = await refreshEbayPrices(db as unknown as AnySupabaseClient, {
      searchFn: matchingSearchFn,
      noRetryDelay: true,
    });
    expect(result.status).toBe('ok');
    expect(result.inserted).toBe(1);
    const row = db.tables.merchant_products[0] as Row;
    expect(row.price).toBe(899);
    expect(row.price_verification_status).toBe('verified');
    expect(row.price_source).toBe('ebay-browse-api');
    expect(typeof row.price_verified_at).toBe('string');
    expect(typeof row.last_synced_at).toBe('string');
  });

  it('stamps the same fields on update of an existing eBay row', async () => {
    const db = fakeSupabase({
      merchantProducts: [
        {
          id: 'mp-1',
          product_id: 'p-macbook',
          merchant_id: 'm-ebay',
          price: 999,
          currency_id: 'cur-usd',
          url: 'https://www.ebay.com/itm/old',
          merchant_sku: 'old',
          availability: 'in_stock',
          in_stock: true,
        },
      ],
    });
    const result = await refreshEbayPrices(db as unknown as AnySupabaseClient, {
      searchFn: matchingSearchFn,
      noRetryDelay: true,
    });
    expect(result.status).toBe('ok');
    expect(result.updated).toBe(1);
    const row = db.tables.merchant_products[0] as Row;
    expect(row.price).toBe(899);
    expect(row.price_verification_status).toBe('verified');
    expect(row.price_source).toBe('ebay-browse-api');
    expect(typeof row.price_verified_at).toBe('string');
  });

  it('retries without the stamp on 42703 (migration 045 unapplied) and still records the price', async () => {
    const db = fakeSupabase({}, { failStampedWrites: true });
    const result = await refreshEbayPrices(db as unknown as AnySupabaseClient, {
      searchFn: matchingSearchFn,
      noRetryDelay: true,
    });
    expect(result.status).toBe('ok');
    expect(result.inserted).toBe(1);
    const row = db.tables.merchant_products[0] as Row;
    expect(row.price).toBe(899);
    expect(row.price_verification_status).toBeUndefined();
    expect(row.price_source).toBeUndefined();
  });

  it('records provider_health for eBay on a successful run', async () => {
    const db = fakeSupabase({});
    const result = await refreshEbayPrices(db as unknown as AnySupabaseClient, {
      searchFn: matchingSearchFn,
      noRetryDelay: true,
    });
    expect(result.status).toBe('ok');
    const health = db.tables.provider_health.find(
      (r) => r.provider_key === 'ebay'
    ) as Row | undefined;
    expect(health).toBeDefined();
    expect(health?.success_count).toBe(1);
    expect(health?.consecutive_failures).toBe(0);
  });

  it('a failed merchant_products write reports failed, never throws', async () => {
    const db = fakeSupabase({}, { failWrites: true });
    const result = await refreshEbayPrices(db as unknown as AnySupabaseClient, {
      searchFn: matchingSearchFn,
      noRetryDelay: true,
    });
    expect(result.status).toBe('ok');
    expect(result.failed).toBe(1);
    expect(result.products[0]?.outcome).toBe('failed');
  });
});

describe('ensureCsvDataSource (#58)', () => {
  it('creates the providers + data_sources rows, then reports exists', async () => {
    const db = fakeSupabase({});
    const client = db as unknown as AnySupabaseClient;
    expect(
      await ensureCsvDataSource(client, { sourceUrl: 'https://8.8.8.8/feed.csv' })
    ).toBe('created');
    expect(db.tables.providers).toHaveLength(1);
    expect((db.tables.providers[0] as Row).key).toBe('csv');
    expect(db.tables.data_sources).toHaveLength(1);
    expect((db.tables.data_sources[0] as Row).source_url).toBe('https://8.8.8.8/feed.csv');
    expect(
      await ensureCsvDataSource(client, { sourceUrl: 'https://8.8.8.8/feed.csv' })
    ).toBe('exists');
    expect(db.tables.providers).toHaveLength(1);
    expect(db.tables.data_sources).toHaveLength(1);
  });

  it('returns skipped for an empty URL and never throws on a broken client', async () => {
    const db = fakeSupabase({});
    expect(
      await ensureCsvDataSource(db as unknown as AnySupabaseClient, { sourceUrl: '  ' })
    ).toBe('skipped');
    const broken = {
      from() {
        throw new Error('db down');
      },
    } as unknown as AnySupabaseClient;
    expect(
      await ensureCsvDataSource(broken, { sourceUrl: 'https://8.8.8.8/feed.csv' })
    ).toBe('skipped');
  });
});

describe('generic webhook SSRF guard (#96)', () => {
  const message = {
    productName: 'MacBook Air 13',
    triggeredPrice: 999,
    targetPrice: 1099,
    productUrl: 'https://8.8.8.8/p/macbook',
  };

  it('refuses a private webhook URL before any fetch', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await sendGenericWebhook(
      'http://127.0.0.1/hook',
      null,
      message,
      fetchSpy as never
    );
    expect(result.status).toBe('failed');
    expect(result.detail).toMatch(/public address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still sends to a literal public IP', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await sendGenericWebhook(
      'https://8.8.8.8/hook',
      null,
      message,
      fetchSpy as never
    );
    expect(result.status).toBe('sent');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('static guards — maxDuration, headers, guard wiring (#55, #54, #38, #95, #96)', () => {
  it('uptime/check exports maxDuration = 60 like the other cron routes', () => {
    expect(uptimeCheckMaxDuration).toBe(60);
  });

  it('migration 052 header no longer claims fail-open on any error', () => {
    const header = readSource(
      'supabase/migrations/20261112214000_052_refresh_runs_one_running.sql'
    );
    expect(header).not.toContain('fail-open on any error');
    expect(header).toContain('fail-open ONLY when the table is missing');
    expect(header).toContain('Section 18 item 35');
  });

  it('the refresh route header no longer claims eBay is a live fetch leg', () => {
    const header = readSource('app/api/v1/prices/refresh/route.ts');
    expect(header).toContain('NOT live today');
    expect(header).not.toContain('the first LIVE fetch leg. Before any recorded-price step runs');
  });

  it('the scan route validates the image URL with the SSRF guard before Lens', () => {
    const src = readSource('app/api/v1/scan/route.ts');
    expect(src).toContain('isPublicImageUrl(imageUrl)');
    expect(src).toContain('isSafePublicImageUrl(imageUrl)');
  });

  it('the generic webhook reuses the SSRF guard at send time and at registration', () => {
    expect(readSource('lib/generic-webhook.ts')).toContain('isSafePublicImageUrl');
    expect(readSource('app/api/v1/settings/webhooks/route.ts')).toContain(
      'isSafePublicImageUrl(raw)'
    );
  });

  it('intake approve audits via recordAdminAction, not a direct insert', () => {
    const src = readSource('app/api/v1/admin/intake/route.ts');
    expect(src).toContain("recordAdminAction(");
    expect(src).toContain("'catalog_intake_approve'");
    expect(src).not.toContain("service.from('admin_audit_logs').insert({");
  });
});

describe('audit rows + error-logging + provider-health wiring (#97, #53, #52)', () => {
  it('QA PATCH audits the admin answer via recordAdminAction (#97)', () => {
    const src = readSource('app/api/v1/products/[slug]/qa/route.ts');
    expect(src).toContain("recordAdminAction(");
    expect(src).toContain("'product_qa_answer'");
  });

  it('data/refresh audits the admin trigger via recordAdminAction (#97)', () => {
    const src = readSource('app/api/v1/data/refresh/route.ts');
    expect(src).toContain("recordAdminAction(");
    expect(src).toContain("'data_refresh_trigger'");
    // The same route is the admin/config path that records a
    // configured CSV source (#58).
    expect(src).toContain('ensureCsvDataSource(');
  });

  it('merchant/refresh services log server errors via logApiError (#53)', () => {
    // ebay-browse, ebay-refresh, pipeline-refresh, refresh-run.
    // services/price-refresh.ts is a sibling worker's file and is
    // deliberately NOT asserted here.
    for (const path of [
      'services/ebay-browse.ts',
      'services/ebay-refresh.ts',
      'services/pipeline-refresh.ts',
      'services/refresh-run.ts',
    ]) {
      const src = readSource(path);
      expect(src).toContain("import { logApiError } from '@/lib/api/error-logging'");
      expect(src).toContain('logApiError(');
    }
  });

  it('eBay + registry providers report health via recordProviderHealth (#52)', () => {
    // eBay adapter: refreshEbayPrices reports through
    // recordProviderHealthAttempt (FINAL 100%, F-P2-04), which
    // writes BOTH trails — provider_health (via
    // reportAiProviderHealth) and data_sources.last_sync_* —
    // and funnels into recordProviderHealth. The direct
    // reportAiProviderHealth call in ebay-refresh.ts was
    // replaced by this wrapper; the funnel is unchanged.
    expect(readSource('services/ebay-refresh.ts')).toContain(
      'recordProviderHealthAttempt(supabase, {'
    );
    expect(readSource('services/provider-health.ts')).toContain(
      'reportAiProviderHealth(supabase, attempt.providerKey, {'
    );
    // Registry providers: the price.refresh processor reports
    // each provider fetch (success / failure / response time).
    expect(readSource('lib/workers/processors.ts')).toContain(
      'reportAiProviderHealth(supabase, provider.key, {'
    );
    // The wrapper itself funnels into recordProviderHealth.
    expect(readSource('services/ai-engine/health-report.ts')).toContain(
      'recordProviderHealth(supabase, { providerKey, ...update })'
    );
  });
});
