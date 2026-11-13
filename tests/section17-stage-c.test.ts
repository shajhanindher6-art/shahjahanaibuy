/**
 * Section 17, Stage C tests (items 14–18).
 *
 *  - 14: price-verification status fields (migration 045 + pure
 *    helpers + UI label rules + service mapping with 42703
 *    fallback while 045 is unapplied).
 *  - 15: approval/published status — intake approve inserts
 *    pending and flips to published; public query paths list
 *    published rows only (with 42703 fallback).
 *  - 16: price_history UNIQUE index lives in 045 (duplicate-
 *    guarded), NOT appended to 040 (whose header forbids it).
 *  - 17: services/pipeline/ caller decision + the
 *    refreshPricesViaPipeline wrapper (no-provider skip,
 *    per-product aggregation); the refresh route itself is NOT
 *    edited here (asserted by file).
 *  - 18: dedicated saved-searches page (file + wiring
 *    assertions; the component's own behaviour is covered by
 *    the Section 15 saved-searches tests).
 *
 * No DB, no network: Supabase clients are faked with the same
 * chainable-builder shape the services use.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import {
  normalizePriceVerificationStatus,
  normalizeProductStatus,
  priceVerificationForIntakeSource,
  priceVerificationLabel,
} from '@/services/price-verification';
import { getProducts, getProductBySlug, getLowestMerchantPrices } from '@/services/products';
import { getMerchantProducts } from '@/services/commerce';
import type { AnySupabaseClient } from '@/lib/supabase/types';

function readRepo(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const MIGRATION_045 =
  'supabase/migrations/20261112180000_045_catalog_verification_and_published_status.sql';
const MIGRATION_040 = 'supabase/migrations/20261112093000_040_price_refresh_runs.sql';

// ---------------------------------------------------------------------------
// Item 16 + 14/15 — migration 045 file assertions
// ---------------------------------------------------------------------------

describe('migration 045 — verification + published status (items 14–16)', () => {
  const sql = readRepo(MIGRATION_045);

  it('exists and is marked DO NOT APPLY YET (written, never applied)', () => {
    expect(existsSync(join(process.cwd(), MIGRATION_045))).toBe(true);
    expect(sql).toContain('DO NOT APPLY YET');
  });

  it('adds products.status with pending/published/rejected and a published default', () => {
    expect(sql).toMatch(/ALTER TABLE products ADD COLUMN status text/);
    expect(sql).toContain("CHECK (status IN ('pending', 'published', 'rejected'))");
    expect(sql).toMatch(/ADD COLUMN status text NOT NULL DEFAULT 'published'/);
  });

  it('adds price_verification_status + price_verified_at on products and merchant_products', () => {
    expect(sql).toMatch(/ALTER TABLE products ADD COLUMN price_verification_status text/);
    expect(sql).toMatch(/ALTER TABLE merchant_products ADD COLUMN price_verification_status text/);
    expect(sql).toMatch(/ALTER TABLE products ADD COLUMN price_verified_at timestamptz/);
    expect(sql).toMatch(/ALTER TABLE merchant_products ADD COLUMN price_verified_at timestamptz/);
    expect(sql).toContain(
      "CHECK (price_verification_status IN ('unverified', 'verified', 'stale'))"
    );
  });

  it('adds price_source on merchant_products only (no ambiguous product-level source, no is_live)', () => {
    expect(sql).toMatch(/ALTER TABLE merchant_products ADD COLUMN price_source text/);
    expect(sql).toContain(
      "CHECK (price_source IN ('manual-intake', 'ebay-browse-api', 'merchant-feed'))"
    );
    expect(sql).not.toMatch(/ADD COLUMN is_live/);
    expect(sql).not.toMatch(/ALTER TABLE products ADD COLUMN price_source/);
  });

  it('creates the price_history UNIQUE index duplicate-guarded, never unconditionally', () => {
    expect(sql).toContain('price_history_product_retailer_recorded_uidx');
    expect(sql).toMatch(/ON public\.price_history \(product_id, retailer_id, recorded_at\)/);
    // Guard: index only when no duplicate exists, else NOTICE.
    expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/);
    expect(sql).toContain('RAISE NOTICE');
  });

  it('does NOT append the UNIQUE index to 040 (040’s own header forbids it)', () => {
    const sql040 = readRepo(MIGRATION_040);
    expect(sql040).toContain('No UNIQUE index on price_history is added here');
    expect(sql040).not.toContain('CREATE UNIQUE INDEX');
  });
});

// ---------------------------------------------------------------------------
// Item 14 — pure verification helpers
// ---------------------------------------------------------------------------

describe('price-verification helpers (item 14)', () => {
  it('manual-intake prices are unverified with no verified_at', () => {
    const v = priceVerificationForIntakeSource('manual-intake', '2026-11-12T00:00:00.000Z');
    expect(v).toEqual({
      priceVerificationStatus: 'unverified',
      priceSource: 'manual-intake',
      priceVerifiedAt: null,
    });
  });

  it('ebay-browse-api prices are verified with verified_at = approve time', () => {
    const at = '2026-11-12T18:00:00.000Z';
    const v = priceVerificationForIntakeSource('ebay-browse-api', at);
    expect(v).toEqual({
      priceVerificationStatus: 'verified',
      priceSource: 'ebay-browse-api',
      priceVerifiedAt: at,
    });
  });

  it('an unknown intake source throws instead of silently verifying', () => {
    expect(() =>
      priceVerificationForIntakeSource('some-feed' as never, '2026-11-12T00:00:00.000Z')
    ).toThrow(/Unknown intake source/);
  });

  it('labels never claim "live"; verified is the only checked claim', () => {
    const unverified = priceVerificationLabel('unverified', null);
    expect(unverified.text).toContain('Unverified price');
    expect(unverified.text).toContain('not checked live');
    expect(unverified.text).not.toMatch(/^Live /);
    expect(unverified.tone).toBe('muted');

    const verified = priceVerificationLabel('verified', 'Nov 12, 2026');
    expect(verified.text).toBe('Verified price — checked Nov 12, 2026');
    expect(verified.text).not.toContain('live');
    expect(verified.tone).toBe('ok');
    expect(verified.shortText).toBe('Verified price');

    const stale = priceVerificationLabel('stale', 'Nov 2, 2026');
    expect(stale.text).toContain('stale');
    expect(stale.tone).toBe('warn');
  });

  it('normalizers fail open honestly: unknown → unverified, unknown status → published', () => {
    expect(normalizePriceVerificationStatus('bogus')).toBe('unverified');
    expect(normalizePriceVerificationStatus(null)).toBe('unverified');
    expect(normalizePriceVerificationStatus('verified')).toBe('verified');
    expect(normalizeProductStatus(null)).toBe('published');
    expect(normalizeProductStatus('pending')).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Items 14–15 — product query path (published-only + 42703 fallback)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function productRow(overrides: Partial<Row> = {}): Row {
  return {
    id: '1',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    description: 'Apple MacBook Air 13.',
    brand: 'Apple',
    category: 'Laptops',
    image_url: null,
    gtin: null,
    confidence_score: 100,
    data_freshness: '2026-11-02T07:13:52.000Z',
    status: 'published',
    price_verification_status: 'unverified',
    price_verified_at: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Fake products client: applies .eq/.neq literally (PostgREST
 * semantics), projects only the selected columns (a legacy select
 * returns rows WITHOUT the 045 fields, the way PostgREST would),
 * and answers 42703 when the select list mentions a column the
 * `missingColumns` set names — i.e. the live table before
 * migration 045 is applied.
 */
function projectProductRows(rows: Row[], select: string): Row[] {
  if (select.includes('status')) return rows;
  return rows.map((r) => {
    const { status: _s, price_verification_status: _v, price_verified_at: _a, ...rest } = r;
    return rest;
  });
}

function fakeProductsClient(rows: Row[], missingColumns: string[] = []) {
  const calls: { select: string; eq: Array<[string, unknown]> }[] = [];
  return {
    calls,
    client: {
      from: () => {
        const state: { select: string; eq: Array<[string, unknown]>; neq: Array<[string, unknown]> } = {
          select: '',
          eq: [],
          neq: [],
        };
        const chain: Record<string, unknown> = {};
        chain.select = (cols: string) => {
          state.select = cols;
          return chain;
        };
        chain.is = () => chain;
        chain.neq = (col: string, value: unknown) => {
          state.neq.push([col, value]);
          return chain;
        };
        chain.eq = (col: string, value: unknown) => {
          state.eq.push([col, value]);
          return chain;
        };
        chain.or = () => chain;
        chain.order = () => chain;
        chain.range = () => chain;
        chain.maybeSingle = async () => {
          calls.push({ select: state.select, eq: [...state.eq] });
          if (missingColumns.some((c) => state.select.includes(c))) {
            return { data: null, error: { code: '42703', message: `column does not exist` } };
          }
          const found = projectProductRows(rows, state.select).filter((r) =>
            state.eq.every(([col, value]) => r[col] === value)
          ).filter((r) =>
            state.neq.every(([col, value]) => r[col] !== value)
          );
          return { data: found[0] ?? null, error: null };
        };
        chain.then = (resolve: (v: unknown) => void) => {
          calls.push({ select: state.select, eq: [...state.eq] });
          if (missingColumns.some((c) => state.select.includes(c))) {
            resolve({ data: null, error: { code: '42703', message: 'column does not exist' }, count: 0 });
            return;
          }
          const filtered = projectProductRows(rows, state.select).filter((r) =>
            state.eq.every(([col, value]) => r[col] === value)
          ).filter((r) =>
            state.neq.every(([col, value]) => r[col] !== value)
          );
          resolve({ data: filtered, error: null, count: filtered.length });
        };
        return chain;
      },
    } as unknown as AnySupabaseClient,
  };
}

describe('getProducts / getProductBySlug — published-only (item 15)', () => {
  it('excludes pending products from the list (query filter, honest count)', async () => {
    const pending = productRow({ id: '2', slug: 'pending-thing', name: 'Pending Thing', status: 'pending' });
    const { client } = fakeProductsClient([productRow(), pending]);
    const result = await getProducts(client, { pageSize: 100 });
    expect(result.products.map((p) => p.slug)).toEqual(['macbook-air-13']);
    expect(result.total).toBe(1);
  });

  it('maps the verification rollup onto the product', async () => {
    const verified = productRow({
      price_verification_status: 'verified',
      price_verified_at: '2026-11-12T10:00:00.000Z',
    });
    const { client } = fakeProductsClient([verified]);
    const [p] = (await getProducts(client)).products;
    expect(p?.status).toBe('published');
    expect(p?.priceVerificationStatus).toBe('verified');
    expect(p?.priceVerifiedAt).toBe('2026-11-12T10:00:00.000Z');
  });

  it('retries without the 045 columns on 42703 (migration unapplied) and still lists rows', async () => {
    const { client, calls } = fakeProductsClient([productRow()], ['status']);
    const result = await getProducts(client, { pageSize: 100 });
    expect(result.products.map((p) => p.slug)).toEqual(['macbook-air-13']);
    expect(result.total).toBe(1);
    // First attempt selected the new columns; the retry did not.
    expect(calls[0]?.select).toContain('status');
    expect(calls[1]?.select).not.toContain('status');
    // Pre-migration rows read as published + unverified.
    expect(result.products[0]?.status).toBe('published');
    expect(result.products[0]?.priceVerificationStatus).toBe('unverified');
  });

  it('getProductBySlug returns null for a pending slug', async () => {
    const pending = productRow({ slug: 'pending-thing', status: 'pending' });
    const { client } = fakeProductsClient([pending]);
    await expect(getProductBySlug(client, 'pending-thing')).resolves.toBeNull();
  });

  it('getProductBySlug retries on 42703 and finds the row', async () => {
    const { client } = fakeProductsClient([productRow()], ['status']);
    const product = await getProductBySlug(client, 'macbook-air-13');
    expect(product?.slug).toBe('macbook-air-13');
    expect(product?.status).toBe('published');
  });
});

// --- merchant price verification (item 14) ---------------------------------

function fakeMerchantClient(rows: Row[], missingColumns: string[] = []) {
  const selects: string[] = [];
  return {
    selects,
    client: {
      from: () => {
        const state: { select: string } = { select: '' };
        const chain: Record<string, unknown> = {};
        chain.select = (cols: string) => {
          state.select = cols;
          return chain;
        };
        chain.in = () => chain;
        chain.is = () => chain;
        chain.eq = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.then = (resolve: (v: unknown) => void) => {
          selects.push(state.select);
          if (missingColumns.some((c) => state.select.includes(c))) {
            resolve({ data: null, error: { code: '42703', message: 'column does not exist' } });
            return;
          }
          // PostgREST projection: a legacy select returns rows
          // WITHOUT the 045 verification fields.
          const out = state.select.includes('price_verification_status')
            ? rows
            : rows.map((r) => {
                const {
                  price_verification_status: _v,
                  price_source: _s,
                  price_verified_at: _a,
                  ...rest
                } = r;
                return rest;
              });
          resolve({ data: out, error: null });
        };
        return chain;
      },
    } as unknown as AnySupabaseClient,
  };
}

describe('merchant price verification mapping (item 14)', () => {
  const cheapestVerified: Row = {
    product_id: '1',
    merchant_id: 'm-amazon',
    price: 999,
    compare_at_price: 1099,
    in_stock: true,
    deleted_at: null,
    price_verification_status: 'verified',
    price_source: 'ebay-browse-api',
    price_verified_at: '2026-11-12T10:00:00.000Z',
  };

  it('getLowestMerchantPrices carries the cheapest listing’s verification', async () => {
    const { client } = fakeMerchantClient([cheapestVerified]);
    const prices = await getLowestMerchantPrices(client, ['1']);
    const entry = prices.get('1');
    expect(entry?.price).toBe(999);
    expect(entry?.priceVerificationStatus).toBe('verified');
    expect(entry?.priceSource).toBe('ebay-browse-api');
    expect(entry?.priceVerifiedAt).toBe('2026-11-12T10:00:00.000Z');
  });

  it('getLowestMerchantPrices retries without the 045 columns on 42703', async () => {
    const { client, selects } = fakeMerchantClient([cheapestVerified], ['price_verification_status']);
    const prices = await getLowestMerchantPrices(client, ['1']);
    expect(prices.get('1')?.price).toBe(999);
    // Retry defaulted honestly: unverified / manual-intake.
    expect(prices.get('1')?.priceVerificationStatus).toBe('unverified');
    expect(prices.get('1')?.priceSource).toBe('manual-intake');
    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain('price_verification_status');
    expect(selects[1]).not.toContain('price_verification_status');
  });

  it('getMerchantProducts maps verification and retries on 42703', async () => {
    const listing: Row = {
      id: 'mp-1',
      product_id: '1',
      merchant_id: 'm-amazon',
      merchant_sku: 'SKU-1',
      price: 999,
      compare_at_price: null,
      currency_id: null,
      availability: 'in_stock',
      url: null,
      shipping_cost: null,
      shipping_days: null,
      in_stock: true,
      stock_quantity: null,
      last_synced_at: null,
      price_verification_status: 'verified',
      price_source: 'ebay-browse-api',
      price_verified_at: '2026-11-12T10:00:00.000Z',
    };
    const { client } = fakeMerchantClient([listing]);
    const [mp] = await getMerchantProducts(client, '1');
    expect(mp?.priceVerificationStatus).toBe('verified');
    expect(mp?.priceSource).toBe('ebay-browse-api');

    const legacy = fakeMerchantClient([listing], ['price_verification_status']);
    const [mpLegacy] = await getMerchantProducts(legacy.client, '1');
    expect(mpLegacy?.priceVerificationStatus).toBe('unverified');
    expect(mpLegacy?.priceSource).toBe('manual-intake');
  });
});

// ---------------------------------------------------------------------------
// Item 15 — intake approve: pending → published (route test)
// ---------------------------------------------------------------------------

const mockServiceState = vi.hoisted(() => ({
  productInserts: [] as Array<Record<string, unknown>>,
  merchantInserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  deletes: [] as Array<Record<string, unknown>>,
  auditInserts: [] as Array<Record<string, unknown>>,
  failNewColumns: false,
  client: null as unknown,
}));

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: () => {},
  requireAdmin: async () => ({ userId: 'admin-1' }),
  rateLimitResponse: async () => null,
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => mockServiceState.client,
}));

function buildFakeService() {
  const failNew = () => mockServiceState.failNewColumns;
  const hasNewColumns = (payload: Record<string, unknown>) =>
    'status' in payload || 'price_source' in payload || 'price_verification_status' in payload;

  const makeBuilder = (table: string) => {
    const state: {
      selectCols: string;
      inserted: Record<string, unknown> | null;
      updated: Record<string, unknown> | null;
    } = { selectCols: '', inserted: null, updated: null };
    const chain: Record<string, unknown> = {};
    chain.select = (cols: string) => {
      state.selectCols = cols;
      return chain;
    };
    chain.limit = () => chain;
    chain.eq = () => chain;
    chain.insert = (payload: Record<string, unknown>) => {
      state.inserted = payload;
      return chain;
    };
    chain.update = (payload: Record<string, unknown>) => {
      state.updated = payload;
      return chain;
    };
    chain.delete = () => chain;
    chain.single = async () => {
      if (state.inserted) {
        if (table === 'products') mockServiceState.productInserts.push(state.inserted);
        if (table === 'merchant_products') mockServiceState.merchantInserts.push(state.inserted);
        if (table === 'admin_audit_logs') mockServiceState.auditInserts.push(state.inserted);
        if (failNew() && hasNewColumns(state.inserted)) {
          return { data: null, error: { code: '42703', message: 'column "status" does not exist' } };
        }
        return { data: { id: 'p-1' }, error: null };
      }
      return { data: null, error: null };
    };
    chain.then = (resolve: (v: unknown) => void) => {
      if (state.inserted) {
        if (table === 'products') mockServiceState.productInserts.push(state.inserted);
        if (table === 'merchant_products') mockServiceState.merchantInserts.push(state.inserted);
        if (table === 'admin_audit_logs') mockServiceState.auditInserts.push(state.inserted);
        if (failNew() && hasNewColumns(state.inserted)) {
          resolve({ data: null, error: { code: '42703', message: 'column does not exist' } });
          return;
        }
        resolve({ data: null, error: null });
        return;
      }
      if (state.updated) {
        mockServiceState.updates.push(state.updated);
        resolve({ data: null, error: null });
        return;
      }
      // loadCatalogContext selects.
      if (table === 'merchants') {
        resolve({ data: [{ id: 'm-1', slug: 'amazon', name: 'Amazon' }], error: null });
        return;
      }
      if (table === 'currencies') {
        resolve({ data: [{ id: 'c-1', code: 'USD' }], error: null });
        return;
      }
      resolve({ data: [], error: null });
    };
    return chain;
  };
  return { from: (table: string) => makeBuilder(table) };
}

mockServiceState.client = buildFakeService() as never;

describe('intake approve — pending → published (item 15)', () => {
  beforeEach(() => {
    mockServiceState.productInserts = [];
    mockServiceState.merchantInserts = [];
    mockServiceState.updates = [];
    mockServiceState.deletes = [];
    mockServiceState.auditInserts = [];
    mockServiceState.failNewColumns = false;
  });

  const approveBody = (source?: string) => ({
    action: 'approve',
    ...(source ? { source } : {}),
    rows: [
      {
        rowNumber: 2,
        name: 'MacBook Air 13',
        slug: 'macbook-air-13',
        brand: 'Apple',
        category: 'Laptops',
        price: '999',
        currency: 'USD',
        merchant: 'amazon',
      },
    ],
    includeRowNumbers: [],
  });

  async function postApprove(source?: string) {
    const { POST } = await import('@/app/api/v1/admin/intake/route');
    const req = new NextRequest('http://localhost/api/v1/admin/intake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(approveBody(source)),
    });
    const res = await POST(req);
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  it('inserts as pending + unverified, then flips to published', async () => {
    const { res, body } = await postApprove();
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>).inserted).toEqual(['macbook-air-13']);
    expect((body.data as Record<string, unknown>).publication).toBe('pending-then-published');

    expect(mockServiceState.productInserts).toHaveLength(1);
    expect(mockServiceState.productInserts[0]?.status).toBe('pending');
    expect(mockServiceState.productInserts[0]?.price_verification_status).toBe('unverified');
    expect(mockServiceState.productInserts[0]?.price_verified_at).toBeNull();

    expect(mockServiceState.merchantInserts).toHaveLength(1);
    expect(mockServiceState.merchantInserts[0]?.price_verification_status).toBe('unverified');
    expect(mockServiceState.merchantInserts[0]?.price_source).toBe('manual-intake');

    expect(mockServiceState.updates).toEqual([{ status: 'published' }]);
  });

  it('eBay source inserts verified with verified_at stamped', async () => {
    const { body } = await postApprove('ebay-browse-api');
    expect((body.data as Record<string, unknown>).inserted).toEqual(['macbook-air-13']);
    expect(mockServiceState.productInserts[0]?.price_verification_status).toBe('verified');
    expect(mockServiceState.productInserts[0]?.price_verified_at).toEqual(
      mockServiceState.merchantInserts[0]?.price_verified_at
    );
    expect(mockServiceState.merchantInserts[0]?.price_source).toBe('ebay-browse-api');
  });

  it('retries without the 045 columns on 42703 and reports legacy mode', async () => {
    mockServiceState.failNewColumns = true;
    const { res, body } = await postApprove();
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>).inserted).toEqual(['macbook-air-13']);
    expect((body.data as Record<string, unknown>).publication).toBe('legacy-no-status-column');
    // Two product inserts (failed with-columns, then legacy) and two merchant inserts.
    expect(mockServiceState.productInserts).toHaveLength(2);
    expect(mockServiceState.productInserts[1]).not.toHaveProperty('status');
    expect(mockServiceState.merchantInserts).toHaveLength(2);
    // No publish flip in legacy mode (no status column to flip).
    expect(mockServiceState.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Item 17 — pipeline wiring decision + wrapper
// ---------------------------------------------------------------------------

const mockRegistry = vi.hoisted(() => ({
  available: [] as Array<{ key: string }>,
  // Sections 21–25, Stage B (B2) — refreshPricesViaPipeline reads
  // getAll() for the unavailable-reason string, so the mock
  // registry must provide it (was missing → getAll is not a
  // function when no provider is available).
  all: [] as Array<{ name: string; getNotConfiguredReason: () => string | null }>,
}));
const mockProcessor = vi.hoisted(() => ({
  fn: vi.fn(),
}));

vi.mock('@/services/providers', () => ({
  getProviderRegistry: () => ({
    getAvailable: () => mockRegistry.available,
    getAll: () => mockRegistry.all,
  }),
}));

vi.mock('@/lib/workers/processors', () => ({
  processors: {
    'price.refresh': (...args: unknown[]) => mockProcessor.fn(...args),
  },
}));

function fakeDueClient(rows: Array<{ id: string }>) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.is = () => chain;
  chain.lte = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.eq = () => chain;
  chain.then = (resolve: (v: unknown) => void) => {
    resolve({ data: rows, error: null });
  };
  return { from: () => chain } as unknown as AnySupabaseClient;
}

describe('pipeline refresh wrapper (item 17)', () => {
  beforeEach(() => {
    mockRegistry.available = [];
    mockProcessor.fn.mockReset();
  });

  it('reports the wiring decision in code: ingestion is NOT the refresh path', () => {
    const src = readRepo('services/pipeline-refresh.ts');
    expect(src).toContain('do NOT wire the refresh chain to pipeline');
    expect(src).toContain('ingestProduct');
    expect(src).toContain("processors['price.refresh']");
    expect(src).toContain('refreshPricesViaPipeline');
    // The exact call site for the later worker, documented in the file.
    expect(src).toContain('app/api/v1/prices/refresh/route.ts');
    expect(src).toContain("runRefreshStep(\n *     'refreshPricesViaPipeline'");
  });

  it('Stage D wired the refresh route (this assertion superseded the pre-wiring check)', () => {
    const route = readRepo('app/api/v1/prices/refresh/route.ts');
    expect(route).toContain('refreshPricesViaPipeline');
    expect(route).toContain('pipeline-refresh');
    expect(route).toContain('pipeline: summarizeStep(pipeline, {');
    // Ingestion is still NOT wired — the step re-fetches prices,
    // it never creates products.
    expect(route).not.toContain('ingestBatch');
    expect(route).not.toContain('ingestProduct');
  });

  it('skips honestly with no available provider and never calls the processor', async () => {
    const { refreshPricesViaPipeline } = await import('@/services/pipeline-refresh');
    const result = await refreshPricesViaPipeline(fakeDueClient([{ id: 'p-1' }]));
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-available-provider');
    expect(result.checked).toBe(0);
    expect(mockProcessor.fn).not.toHaveBeenCalled();
  });

  it('runs the price.refresh processor once per due product and aggregates', async () => {
    mockRegistry.available = [{ key: 'apify' }];
    mockProcessor.fn
      .mockResolvedValueOnce({ success: true, processed: 1 })
      .mockResolvedValueOnce({ success: false, processed: 0, errors: ['No product sources found for product'] });
    const { refreshPricesViaPipeline } = await import('@/services/pipeline-refresh');
    const result = await refreshPricesViaPipeline(
      fakeDueClient([{ id: 'p-1' }, { id: 'p-2' }])
    );
    expect(result.available).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('p-2');
    expect(mockProcessor.fn).toHaveBeenCalledTimes(2);
    expect(mockProcessor.fn).toHaveBeenCalledWith({
      type: 'price.refresh',
      data: { productId: 'p-1' },
    });
  });

  it('returns checked 0 with no due products', async () => {
    mockRegistry.available = [{ key: 'apify' }];
    const { refreshPricesViaPipeline } = await import('@/services/pipeline-refresh');
    const result = await refreshPricesViaPipeline(fakeDueClient([]));
    expect(result).toEqual({ available: true, checked: 0, refreshed: 0, failed: 0, errors: [] });
    expect(mockProcessor.fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Item 18 — dedicated saved-searches page
// ---------------------------------------------------------------------------

describe('saved-searches dedicated page (item 18)', () => {
  it('exists with metadata, renders the shared component, and links from the dashboard', () => {
    const page = readRepo('app/dashboard/saved-searches/page.tsx');
    expect(page).toContain('export const metadata');
    expect(page).toContain('Saved searches | SmartBuy');
    expect(page).toContain('<SavedSearches />');
    expect(page).toContain('/search');
    expect(page).toContain('Save search');

    expect(existsSync(join(process.cwd(), 'app/dashboard/saved-searches/loading.tsx'))).toBe(true);

    const dashboard = readRepo('app/dashboard/page.tsx');
    expect(dashboard).toContain('/dashboard/saved-searches');
  });

  it('is auth-gated by the dashboard layout and NOT in the sitemap (robots-disallowed)', () => {
    const layout = readRepo('app/dashboard/layout.tsx');
    expect(layout).toContain('index: false');
    const sitemap = readRepo('app/sitemap.ts');
    expect(sitemap).not.toContain('/dashboard/saved-searches');
  });
});
