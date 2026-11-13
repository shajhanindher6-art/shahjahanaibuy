/**
 * Worker W2 — LABEL HONESTY + PRICE SURFACES (Final 100% Product &
 * Real Data Completion). Regression tests for F-P0-06, F-P1-02,
 * F-P1-03, F-P1-04, F-P2-03, F-P2-15, F-P2-16, F-P2-17, F-P2-18,
 * F-P2-19, F-P2-21, F-P1-26.
 *
 * Items verified ALREADY DONE in the tree (pinned here, not
 * rebuilt): F-P2-17 (deals card "% OFF vs list price", Section 20
 * §12 #40), F-P1-26 (forecast + buy-wait unified at 5 points,
 * Section 20 §12 #46).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  formatRecordedPriceNote,
  getFreshnessStatus,
} from '@/lib/price-freshness';
import { getDataQualityState } from '@/services/product-quality-score';
import {
  findDuplicate,
  findDuplicateCandidates,
  GTIN_MATCH_CONFIDENCE,
} from '@/services/pipeline/deduplication';
import { getProducts } from '@/services/products';
import { getAdminDataQualitySummary } from '@/services/admin-data-quality';
import { buildProductJsonLd } from '@/lib/product-seo';
import { buildFreshnessRow } from '@/lib/catalog-freshness';
import {
  verifiedDataLabel,
  verifiedDataRangeLabel,
  recordedDataLabel,
} from '@/lib/ai-source-label';
import { EBAY_PRICE_HISTORY_NOTE } from '@/services/ebay-refresh';
import {
  computeForecast,
  FORECAST_MIN_POINTS,
} from '@/lib/forecast';
import {
  predictBuyVsWait,
  BUY_WAIT_MIN_POINTS,
} from '@/services/buy-wait-prediction';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// Small chainable Supabase fake (same shape as
// tests/section20-admin-catalog.test.ts).
// ---------------------------------------------------------------------------

type FakeResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
};

const CHAIN_METHODS = [
  'select',
  'eq',
  'neq',
  'is',
  'or',
  'order',
  'range',
  'limit',
  'in',
  'lt',
  'lte',
  'gte',
  'maybeSingle',
  'single',
] as const;

function fakeChain(result: FakeResult): AnySupabaseClient {
  const chain: Record<string, unknown> = {
    then: (resolve: (value: FakeResult) => void) => resolve(result),
  };
  for (const method of CHAIN_METHODS) {
    chain[method] = (..._args: unknown[]) => chain;
  }
  return chain as unknown as AnySupabaseClient;
}

function fakeClient(
  handler: (table: string) => FakeResult
): AnySupabaseClient {
  return {
    from: (table: string) => fakeChain(handler(table)),
  } as unknown as AnySupabaseClient;
}

function ok(data: unknown): FakeResult {
  return {
    data,
    error: null,
    count: Array.isArray(data) ? data.length : null,
  };
}

// ---------------------------------------------------------------------------
// F-P0-06 — surface-level freshness gate: a stale price must never
// render as current; unknown age must never render as fresh.
// ---------------------------------------------------------------------------

describe('F-P0-06 — formatRecordedPriceNote (shared surface gate)', () => {
  const now = new Date('2026-11-13T08:00:00.000Z');

  it('returns null for a fresh price (no qualification needed)', () => {
    expect(formatRecordedPriceNote('2026-11-12T08:00:00.000Z', now)).toBeNull();
  });

  it('labels a stale price with its age in days', () => {
    const note = formatRecordedPriceNote('2026-11-02T07:13:52.000Z', now);
    expect(note).toContain('Recorded price');
    expect(note).toContain('11 days ago');
    expect(note).toContain('may be out of date');
  });

  it('labels unknown age as unknown, never as fresh', () => {
    const note = formatRecordedPriceNote(null, now);
    expect(note).toContain('Recorded price');
    expect(note).toContain('age unknown');
    expect(formatRecordedPriceNote(undefined, now)).not.toBeNull();
    expect(formatRecordedPriceNote('not-a-date', now)).not.toBeNull();
  });
});

describe('F-P0-06 — Budget Finder no longer claims verified prices (source pin)', () => {
  const src = readFileSync(
    join(process.cwd(), 'app/tools/budget-finder/page.tsx'),
    'utf8'
  );

  it('never says "Prices are verified merchant prices"', () => {
    expect(src).not.toContain('Prices are verified merchant prices');
    expect(src).not.toContain('No product with a verified price fits');
    expect(src).toContain('Recorded prices only');
    expect(src).toContain('StalePriceBadge');
  });
});

// ---------------------------------------------------------------------------
// F-P1-02 / F-P1-04 — field presence must not buy a verification
// label: the taxonomy `partial` branch is removed (GTIN leg and
// price-source leg both).
// ---------------------------------------------------------------------------

describe('F-P1-02 / F-P1-04 — taxonomy never upgrades on field presence', () => {
  const base = {
    priceVerificationStatus: 'unverified' as const,
    priceAgeDays: 1,
    merchantCount: 2,
    hasValidGtin: false,
    hasPriceSource: false,
  };

  it('a GS1-valid GTIN alone does NOT earn "Partially verified"', () => {
    const r = getDataQualityState({ ...base, hasValidGtin: true });
    expect(r.state).toBe('unverified');
    expect(r.state).not.toBe('partial');
  });

  it('a recorded price source (incl. manual-intake) alone does NOT earn it', () => {
    const r = getDataQualityState({ ...base, hasPriceSource: true });
    expect(r.state).toBe('unverified');
  });

  it('GTIN + price source together still do NOT earn it', () => {
    const r = getDataQualityState({
      ...base,
      hasValidGtin: true,
      hasPriceSource: true,
    });
    expect(r.state).toBe('unverified');
  });

  it('verified + fresh still earns "Verified" (the gate itself is intact)', () => {
    const r = getDataQualityState({
      ...base,
      priceVerificationStatus: 'verified',
      priceAgeDays: 1,
    });
    expect(r.state).toBe('verified');
  });

  it('verified with no check date still expires to "Stale"', () => {
    const r = getDataQualityState({
      ...base,
      priceVerificationStatus: 'verified',
      priceAgeDays: null,
    });
    expect(r.state).toBe('stale');
  });
});

// ---------------------------------------------------------------------------
// F-P1-03 — GTIN match confidence is capped below absolute certainty.
// ---------------------------------------------------------------------------

describe('F-P1-03 — GTIN-match confidence can never be 1.0', () => {
  it('the cap constant is below 1', () => {
    expect(GTIN_MATCH_CONFIDENCE).toBeLessThan(1);
    expect(GTIN_MATCH_CONFIDENCE).toBe(0.9);
  });

  it('findDuplicate caps a GTIN match at 0.9', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok({ id: 'prod-gtin' });
      }
      return ok(null);
    });
    // The fake chain's maybeSingle resolves the same result for
    // every query; the GTIN leg runs first and returns.
    const out = await findDuplicate(client, {
      gtin: '4006381333931',
      slug: 'other-slug',
      name: 'Other Name',
      brand: 'Other',
    } as never);
    expect(out.isDuplicate).toBe(true);
    expect(out.matchedBy).toBe('gtin');
    expect(out.confidence).toBe(0.9);
  });

  it('findDuplicateCandidates caps a GTIN pair at 0.9', () => {
    const out = findDuplicateCandidates([
      { id: 'a', slug: 'a', name: 'MacBook Air 13', brand: 'Apple', gtin: '4006381333931' },
      { id: 'b', slug: 'b', name: 'Something Else Entirely', brand: 'Other', gtin: '4006381333931' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.matchedBy).toBe('gtin');
    expect(out[0]?.confidence).toBe(0.9);
  });

  it('exact name+brand still reports 1.0 (only the GTIN leg is capped)', () => {
    const out = findDuplicateCandidates([
      { id: 'a', slug: 'a', name: 'MacBook Air 13', brand: 'Apple' },
      { id: 'b', slug: 'b', name: 'MacBook Air 13', brand: 'Apple' },
    ]);
    expect(out[0]?.matchedBy).toBe('name-brand');
    expect(out[0]?.confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F-P2-03 — legacy confidenceScore is gone from API payloads.
// ---------------------------------------------------------------------------

describe('F-P2-03 — public products API no longer emits confidenceScore', () => {
  it('getProducts maps rows without the legacy field, even when the row carries 50', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          {
            id: 'p1',
            name: 'MacBook Air 13',
            slug: 'macbook-air-13',
            description: 'Thin laptop.',
            brand: 'Apple',
            category: 'Laptops',
            image_url: null,
            gtin: null,
            model_number: null,
            confidence_score: 50,
            data_freshness: '2026-11-02T07:13:52.000Z',
            created_at: '2026-11-02T07:13:52.000Z',
            updated_at: '2026-11-02T07:13:52.000Z',
            status: 'published',
            price_verification_status: 'unverified',
            price_verified_at: null,
          },
        ]);
      }
      return ok([]);
    });
    const { products } = await getProducts(client, {});
    expect(products).toHaveLength(1);
    expect(products[0]).not.toHaveProperty('confidenceScore');
    expect(products[0]?.name).toBe('MacBook Air 13');
  });
});

// ---------------------------------------------------------------------------
// F-P2-15 — suspicious flags have a review surface (admin summary).
// ---------------------------------------------------------------------------

describe('F-P2-15 — suspicious price flags are listed for review', () => {
  it('flagged history rows land in suspiciousPriceFlags with product, price, date, source', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          {
            id: 'p1', name: 'MacBook Air 13', slug: 'macbook-air-13', brand: 'Apple',
            category: 'Laptops', description: 'Thin laptop.', image_url: null, gtin: null,
            price_verification_status: 'unverified', price_verified_at: null,
            data_freshness: '2026-11-02T07:13:52.000Z',
          },
        ]);
      }
      if (table === 'product_attributes') return ok([]);
      if (table === 'reviews') return ok([]);
      if (table === 'merchant_products') {
        return ok([{ product_id: 'p1', price: 999, in_stock: true, price_source: 'manual-intake' }]);
      }
      if (table === 'price_history') {
        return ok([
          {
            product_id: 'p1', price: 999, recorded_at: '2026-11-02T07:13:52.000Z',
            source: 'manual-intake', suspicious_change: false,
          },
          {
            product_id: 'p1', price: 499, recorded_at: '2026-11-03T07:13:52.000Z',
            source: 'manual-intake', suspicious_change: true,
          },
        ]);
      }
      if (table === 'product_images') return ok([]);
      return ok([]);
    });
    const summary = await getAdminDataQualitySummary(client);
    expect(summary.suspiciousPriceFlagCount).toBe(1);
    expect(summary.suspiciousPriceFlags).toHaveLength(1);
    expect(summary.suspiciousPriceFlags[0]).toMatchObject({
      productId: 'p1',
      productName: 'MacBook Air 13',
      price: 499,
      recordedAt: '2026-11-03T07:13:52.000Z',
      source: 'manual-intake',
    });
    expect(summary.notes.join(' ')).toContain('needs review');
  });

  it('no flags means an empty review queue, not a missing field', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          {
            id: 'p1', name: 'A', slug: 'a', brand: null, category: null, description: null,
            image_url: null, gtin: null, price_verification_status: 'unverified',
            price_verified_at: null, data_freshness: '2026-11-02T07:13:52.000Z',
          },
        ]);
      }
      if (table === 'price_history') {
        return ok([
          { product_id: 'p1', price: 99, recorded_at: '2026-11-02T07:13:52.000Z', source: null, suspicious_change: false },
        ]);
      }
      return ok([]);
    });
    const summary = await getAdminDataQualitySummary(client);
    expect(summary.suspiciousPriceFlagCount).toBe(0);
    expect(summary.suspiciousPriceFlags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-P2-16 — unknown age must read as stale/unknown, never as fresh.
// ---------------------------------------------------------------------------

describe('F-P2-16 — unknown price age is never fresh', () => {
  const seoBase = {
    id: 'p1',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    description: 'Thin laptop.',
    brand: 'Apple',
    category: 'Laptops',
    imageUrl: null,
    gtin: null,
    lowestPrice: 999,
    dataFreshness: null as string | null,
    priceValidUntil: null,
    inStock: true,
    averageRating: 0,
    reviewCount: 0,
  };

  it('SEO offers are suppressed when the age is unknown (not just when stale)', () => {
    const now = new Date('2026-11-13T08:00:00.000Z');
    const unknown = JSON.parse(
      buildProductJsonLd({ ...seoBase, dataFreshness: null }, 'https://example.com', now)
    );
    expect(unknown['@graph'][0].offers).toBeUndefined();

    const stale = JSON.parse(
      buildProductJsonLd({ ...seoBase, dataFreshness: '2026-11-02T07:13:52.000Z' }, 'https://example.com', now)
    );
    expect(stale['@graph'][0].offers).toBeUndefined();

    const fresh = JSON.parse(
      buildProductJsonLd({ ...seoBase, dataFreshness: '2026-11-12T08:00:00.000Z' }, 'https://example.com', now)
    );
    expect(fresh['@graph'][0].offers).toBeDefined();
    expect(fresh['@graph'][0].offers.price).toBe(999);
  });

  it('catalog-freshness rows flag unknown age explicitly', () => {
    const row = buildFreshnessRow(
      {
        id: 'p1', name: 'A', slug: 'a', brand: null, category: null,
        imageUrl: null, gtin: null, dataFreshness: null,
      },
      [],
      new Date('2026-11-13T08:00:00.000Z')
    );
    expect(row.ageUnknown).toBe(true);
    expect(row.stale).toBe(false);
    expect(row.ageDays).toBeNull();
    // A consumer must never read stale === false as "fresh".
    expect(getFreshnessStatus(null).status).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// F-P2-17 — deals card badge (ALREADY DONE, Section 20 §12 #40):
// the per-card "% OFF vs list price" qualifier. Pinned at source
// level because the card lives in a page component.
// ---------------------------------------------------------------------------

describe('F-P2-17 — deals card carries a per-card "vs list price" qualifier (pin)', () => {
  it('the card renders the discount with its basis, not a bare %', () => {
    const src = readFileSync(join(process.cwd(), 'app/deals/page.tsx'), 'utf8');
    expect(src).toContain('${discount}% OFF vs list price');
  });
});

// ---------------------------------------------------------------------------
// F-P2-18 — verifiedDataLabel says what was verified, by whom, and
// when — or renders nothing when that is unknown.
// ---------------------------------------------------------------------------

describe('F-P2-18 — verifiedDataLabel names what / by whom / when', () => {
  it('names the prices, the live check, and the date', () => {
    const label = verifiedDataLabel('2026-11-02T07:13:52Z');
    expect(label).toContain('prices verified');
    expect(label).toContain("SmartBuy's live price check");
    expect(label).toContain('Nov 2, 2026');
    expect(label).toContain('real fetch');
  });

  it('renders nothing (null) when the check date is unknown', () => {
    expect(verifiedDataLabel(null)).toBeNull();
    expect(verifiedDataLabel(undefined as unknown as string | null)).toBeNull();
  });

  it('the recorded label is still the fallback and never claims verification', () => {
    expect(recordedDataLabel(null)).toContain('not live merchant prices');
  });

  it('the range label returns null with no dates and a range with dates', () => {
    expect(verifiedDataRangeLabel([null, null])).toBeNull();
    const label = verifiedDataRangeLabel([
      '2026-11-10T07:13:52Z',
      '2026-11-12T07:13:52Z',
    ]);
    expect(label).toContain("SmartBuy's live price check");
    expect(label).toContain('Nov 10, 2026');
    expect(label).toContain('Nov 12, 2026');
  });
});

// ---------------------------------------------------------------------------
// F-P2-19 — eBay/history design decision is surfaced, not silent.
// ---------------------------------------------------------------------------

describe('F-P2-19 — eBay live checks invisible to history (surfaced decision)', () => {
  it('the surfaced note states the design and the open decision', () => {
    expect(EBAY_PRICE_HISTORY_NOTE).toContain('no price_history row');
    expect(EBAY_PRICE_HISTORY_NOTE).toContain('by design');
    expect(EBAY_PRICE_HISTORY_NOTE).toContain('Open owner/design decision');
    expect(EBAY_PRICE_HISTORY_NOTE).toContain('ebay-browse-api');
  });

  it('the decision is documented in docs/price-data-pipeline.md', () => {
    const src = readFileSync(
      join(process.cwd(), 'docs/price-data-pipeline.md'),
      'utf8'
    );
    expect(src).toContain('F-P2-19');
    expect(src).toContain('one refresh later');
  });
});

// ---------------------------------------------------------------------------
// F-P2-21 — extension price endpoint labels compareAtPrice.
// (Route test with the same mocked-Supabase shape as
// tests/section15-extension-local-merchants.test.ts.)
// ---------------------------------------------------------------------------

const extDb = vi.hoisted(() => ({
  product: {
    id: 'prod-1',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    data_freshness: '2026-11-02T07:13:52.000Z',
  } as Record<string, unknown> | null,
  offers: [
    {
      price: 999,
      compare_at_price: 1099,
      url: 'https://www.amazon.com/dp/B0EXAMPLE',
      in_stock: true,
      availability: 'in_stock',
      products: { name: 'MacBook Air 13', slug: 'macbook-air-13' },
      merchants: { name: 'Amazon' },
    },
    {
      price: 1099,
      compare_at_price: null,
      url: 'https://www.bestbuy.com/site/macbook-air-13',
      in_stock: true,
      availability: 'in_stock',
      products: { name: 'MacBook Air 13', slug: 'macbook-air-13' },
      merchants: { name: 'Best Buy' },
    },
  ] as Record<string, unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const result =
        table === 'products'
          ? { data: extDb.product, error: null }
          : { data: extDb.offers, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'ilike', 'is', 'order', 'limit']) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => result;
      chain.then = (resolve: (value: unknown) => void) => resolve(result);
      return chain;
    },
  }),
}));

import { GET as extensionPriceGET } from '@/app/api/v1/extension/price/route';
import { getRankedDeals } from '@/services/ai-deals';
import { refreshTrackedPrices } from '@/services/price-refresh';
import { suspiciousPriceChangesOf } from '@/services/refresh-runs-admin';

describe('F-P2-21 — extension price endpoint labels compareAtPrice', () => {
  it('labels the compare-at basis and the price staleness on every offer', async () => {
    const res = await extensionPriceGET(
      new NextRequest('http://localhost/api/v1/extension/price?slug=macbook-air-13', {
        headers: { 'x-real-ip': '203.0.113.7' },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{
        merchant: string | null;
        price: number;
        priceBasis: string;
        compareAtPrice: number | null;
        compareAtPriceLabel: string | null;
        compareAtPriceBasis: string | null;
      }>;
      meta?: {
        product?: {
          name: string;
          slug: string;
          priceFreshness: { status: string; lastCheckedAt: string | null };
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    // Offer with a compare-at price: basis + label travel with it.
    expect(body.data[0]?.compareAtPrice).toBe(1099);
    expect(body.data[0]?.compareAtPriceLabel).toBe('vs list price');
    expect(body.data[0]?.compareAtPriceBasis).toContain('never observed in recorded history');
    expect(body.data[0]?.priceBasis).toBe('recorded merchant price');
    // Offer without one: no invented basis.
    expect(body.data[1]?.compareAtPrice).toBeNull();
    expect(body.data[1]?.compareAtPriceLabel).toBeNull();
    expect(body.data[1]?.compareAtPriceBasis).toBeNull();
    // Meta carries the staleness: 11-day-old freshness is stale.
    expect(body.meta?.product?.priceFreshness.status).toBe('stale');
    expect(body.meta?.product?.priceFreshness.lastCheckedAt).toBe(
      '2026-11-02T07:13:52.000Z'
    );
  });
});

// ---------------------------------------------------------------------------
// F-P1-26 — forecast + buy-wait threshold unified at 5 points
// (ALREADY DONE, Section 20 §12 #46 — pinned here).
// ---------------------------------------------------------------------------

describe('F-P1-26 — forecast and buy-wait share one 5-point minimum', () => {
  function points(n: number, ageDays: number) {
    const now = Date.now();
    return Array.from({ length: n }, (_, i) => ({
      price: 1000 - i * 5,
      recordedAt: new Date(now - (ageDays + (n - i)) * 86400000).toISOString(),
    }));
  }

  it('both minima are 5', () => {
    expect(FORECAST_MIN_POINTS).toBe(5);
    expect(BUY_WAIT_MIN_POINTS).toBe(5);
    expect(FORECAST_MIN_POINTS).toBe(BUY_WAIT_MIN_POINTS);
  });

  it('forecast refuses below 5 points', () => {
    expect(computeForecast(points(4, 0)).status).toBe('not-enough-history');
    expect(computeForecast(points(2, 0)).status).toBe('not-enough-history');
    expect(computeForecast(points(4, 0)).forecasts).toEqual([]);
  });

  it('buy-wait issues no verdict below 5 points', () => {
    const p = predictBuyVsWait(points(4, 0));
    expect(p.recommendation).toBe('not_enough_data');
    expect(p.confidence).toBe(0);
    expect(p.reason).toContain('at least 5');
  });

  it('both issue on 5 fresh points (the unified threshold, not a split)', () => {
    expect(computeForecast(points(5, 0)).status).toBe('ok');
    expect(predictBuyVsWait(points(5, 0)).recommendation).not.toBe(
      'not_enough_data'
    );
  });
});

// ---------------------------------------------------------------------------
// F-P2-03 (RESUME) — the legacy score is gone from the OTHER public
// API payloads too, not just /api/v1/products (services/products.ts).
// ai-search, ai-deals and ai-recommendations all used to map
// `row.confidence_score` onto the serialized Product object.
// Behavioural test for ranked deals (the stub shape mirrors
// tests/section19-ai-deals-honesty.test.ts); source pins for
// ai-search / ai-recommendations, whose entry points need
// auth/history context that belongs in their own suites.
// ---------------------------------------------------------------------------

type StubRow = Record<string, unknown>;

function rankedDealsStub(tables: Record<string, StubRow[]>) {
  const inserts: StubRow[] = [];
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    // NOTE (W2-RESUME #2): the `any` below is deliberate (a dynamic
    // query-builder stub) and the repo's flat ESLint config does not
    // define @typescript-eslint/no-explicit-any, so no disable
    // directive may name that rule — a stale one errored the lint.
    const builder: any = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      neq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] !== val);
        return builder;
      },
      gte(col: string, val: unknown) {
        rows = rows.filter((r) => String(r[col]) >= String(val));
        return builder;
      },
      in(col: string, vals: unknown[]) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      },
      is(col: string, val: unknown) {
        rows = rows.filter((r) =>
          val === null ? r[col] === null || r[col] === undefined : r[col] === val
        );
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          if (typeof av === 'number' && typeof bv === 'number') {
            return asc ? av - bv : bv - av;
          }
          return asc
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
        });
        return builder;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      insert(row: StubRow) {
        inserts.push({ table, ...row });
        return Promise.resolve({ data: null, error: null });
      },
      then(
        onFulfilled?: (value: { data: StubRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };
  return {
    client: { from: (table: string) => query(table) } as unknown as AnySupabaseClient,
    inserts,
  };
}

describe('F-P2-03 (resume) — ranked deals no longer emit confidenceScore', () => {
  it('the ranked product carries no legacy field even when the row has 80', async () => {
    const { client } = rankedDealsStub({
      deal_rankings: [],
      deals: [
        {
          id: 'd1',
          product_id: 'p99',
          merchant_id: 'm-amazon',
          title: 'Save $20 on Logitech MX Master 3S',
          description: null,
          deal_type: 'general',
          discount_type: 'fixed',
          discount_value: 20,
          start_at: '2026-11-01T00:00:00.000Z',
          end_at: '2027-01-01T00:00:00.000Z',
          coupon_code: null,
          url: null,
          active: true,
          deleted_at: null,
        },
      ],
      products: [
        {
          id: 'p99',
          name: 'Logitech MX Master 3S',
          slug: 'logitech-mx-master-3s',
          description: 'A mouse.',
          brand: 'Logitech',
          category: 'Accessories',
          image_url: null,
          gtin: null,
          confidence_score: 80,
          data_freshness: '2026-11-02T00:00:00.000Z',
          created_at: '2026-11-01T00:00:00.000Z',
          updated_at: '2026-11-01T00:00:00.000Z',
          deleted_at: null,
        },
      ],
      price_history: [
        { product_id: 'p99', price: 99, recorded_at: '2026-11-02T00:00:00.000Z' },
      ],
    });
    const result = await getRankedDeals(client, { limit: 10 });
    expect(result.deals).toHaveLength(1);
    expect(result.deals[0]?.product).not.toBeNull();
    expect(result.deals[0]?.product).not.toHaveProperty('confidenceScore');
  });

  it('ai-search and ai-recommendations no longer map the legacy column', () => {
    for (const file of ['services/ai-search.ts', 'services/ai-recommendations.ts']) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).not.toContain('confidenceScore: row.confidence_score');
    }
    // The search ranking still uses the raw column value as ONE
    // internal input (local fieldPresenceScore) — ranking only,
    // never exposed on the payload.
    const searchSrc = readFileSync(join(process.cwd(), 'services/ai-search.ts'), 'utf8');
    expect(searchSrc).toContain('fieldPresenceScore');
  });
});

// ---------------------------------------------------------------------------
// F-P2-15 (RESUME) — notification path: a flagged change is counted
// on the refresh run result, rides the cron response + stored step
// counts, and renders on /admin/refresh-runs. Fake client mirrors
// tests/final100-verification-spine.test.ts (refreshTrackedFakeClient).
// ---------------------------------------------------------------------------

function refreshSuspiciousFakeClient() {
  const historyInserts: Array<Record<string, unknown>> = [];
  const client = {
    historyInserts,
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.is = () => chain;
      chain.lt = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.delete = () => chain;
      chain.update = () => chain;
      chain.insert = async (row: Record<string, unknown>) => {
        if (table === 'price_history') historyInserts.push(row);
        return { error: null };
      };
      chain.then = (
        onFulfilled: (v: { data: Array<Record<string, unknown>> | null; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => {
        let data: Array<Record<string, unknown>> = [];
        if (table === 'merchants') {
          data = [{ id: 'm-amazon', slug: 'amazon' }];
        } else if (table === 'retailers') {
          data = [{ id: 'r-amazon', slug: 'amazon' }];
        } else if (table === 'currencies') {
          data = [{ id: 'cur-usd', code: 'USD' }];
        }
        return Promise.resolve({ data, error: null }).then(
          onFulfilled as never,
          onRejected as never
        );
      };
      return chain;
    },
  };
  return client;
}

describe('F-P2-15 (resume) — suspicious flags are counted on the run (notification)', () => {
  const shared = (historyRows: Array<Record<string, unknown>>) => ({
    refreshIds: ['p-1'],
    stockIds: ['p-1'],
    guestProductIds: [],
    merchantRows: [
      {
        product_id: 'p-1',
        merchant_id: 'm-amazon',
        price: 999,
        availability: 'in_stock',
        url: 'https://www.amazon.com/dp/B0EXAMPLE',
        in_stock: true,
        currency_id: null,
        updated_at: '2026-11-13T10:00:00.000Z',
      },
    ] as never,
    historyRows: historyRows as never,
  });

  it('a 100 → 999 spike counts 1 suspicious change and stores the row flagged', async () => {
    const client = refreshSuspiciousFakeClient();
    const r = await refreshTrackedPrices(
      client as never,
      shared([
        {
          product_id: 'p-1',
          retailer_id: 'r-amazon',
          price: 100,
          availability: 'in_stock',
          recorded_at: '2026-11-12T10:00:00.000Z',
        },
      ])
    );
    expect(r.inserted).toBe(1);
    expect(r.suspiciousPriceChanges).toBe(1);
    expect(client.historyInserts).toHaveLength(1);
    expect(client.historyInserts[0]?.suspicious_change).toBe(true);
  });

  it('a small move counts 0 suspicious changes', async () => {
    const client = refreshSuspiciousFakeClient();
    const r = await refreshTrackedPrices(
      client as never,
      shared([
        {
          product_id: 'p-1',
          retailer_id: 'r-amazon',
          price: 990,
          availability: 'in_stock',
          recorded_at: '2026-11-12T10:00:00.000Z',
        },
      ])
    );
    expect(r.inserted).toBe(1);
    expect(r.suspiciousPriceChanges).toBe(0);
    expect(client.historyInserts[0]?.suspicious_change).toBe(false);
  });

  it('suspiciousPriceChangesOf sums the stored step counts (0 when none)', () => {
    expect(
      suspiciousPriceChangesOf({
        steps: {
          refresh: {
            status: 'completed',
            counts: { processed: 1, succeeded: 1, failed: 0, suspiciousPriceChanges: 2 },
          },
          alerts: { status: 'completed', counts: { processed: 0, succeeded: 0, failed: 0 } },
        },
      } as never)
    ).toBe(2);
    expect(suspiciousPriceChangesOf({ steps: {} } as never)).toBe(0);
    expect(suspiciousPriceChangesOf({} as never)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F-P0-06 (RESUME #2) — the remaining "verified / live / current"
// claims, found by re-sweeping every price surface after the first
// W2 worker's pass.
// ---------------------------------------------------------------------------

describe('F-P0-06 (resume) — no remaining "verified / real current" price claims', () => {
  it('help-me-choose never calls its picks verified', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/tools/help-me-choose/page.tsx'),
      'utf8'
    );
    expect(src).not.toContain('Prices are verified merchant prices');
    expect(src).not.toContain('No product with a verified price fits');
    expect(src).toContain('Recorded prices only');
    // Every pick carries the freshness badge under its price.
    expect(src).toContain('StalePriceBadge');
    expect(src).toContain('pick.dataFreshness');
  });

  it('the guided-finder API header no longer claims verified prices', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/api/v1/guided-finder/route.ts'),
      'utf8'
    );
    expect(src).not.toContain('Prices are verified merchant prices only');
    expect(src).toContain('recorded merchant prices only');
  });

  it('live pages never promise a real current price', () => {
    for (const file of ['app/live/page.tsx', 'app/live/[slug]/page.tsx']) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).not.toContain('real current price');
      expect(src).toContain('recorded price');
    }
  });

  it('the live session detail page badges each session price for freshness', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/live/[slug]/page.tsx'),
      'utf8'
    );
    expect(src).toContain('StalePriceBadge');
    expect(src).toContain('product.dataFreshness');
  });
});

// ---------------------------------------------------------------------------
// F-P1-02 (RESUME #2) — every remaining "% off" carries its basis.
// ---------------------------------------------------------------------------

describe('F-P1-02 (resume) — every remaining "% off" carries its basis', () => {
  it('compare best-discount + per-retailer discounts say "vs list price"', () => {
    const src = readFileSync(join(process.cwd(), 'app/compare/page.tsx'), 'utf8');
    expect(src).toContain('−{discount}% vs list price');
    expect(src).toContain('−{r.discount}% vs list price');
    expect(src).not.toMatch(/−\{discount\}%<\/span>/);
    expect(src).not.toMatch(/−\{r\.discount\}%$/m);
  });

  it('help-me-choose picks say "Save X% vs list price"', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/tools/help-me-choose/page.tsx'),
      'utf8'
    );
    expect(src).toContain('Save {pick.savingPct}% vs list price');
  });
});

// ---------------------------------------------------------------------------
// F-P1-03 (RESUME #2) — every price carries its freshness context.
// ---------------------------------------------------------------------------

describe('F-P1-03 (resume) — every price carries its freshness context', () => {
  it('price-history tool shows the last-checked date under the current price', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/tools/price-history/page.tsx'),
      'utf8'
    );
    expect(src).toContain('Last checked');
    expect(src).toContain(
      'summary.points[summary.points.length - 1].recordedAt'
    );
  });
});

// ---------------------------------------------------------------------------
// F-P1-04 (RESUME #2) — the 5-state label rides the public list
// surfaces, not just the detail page.
// ---------------------------------------------------------------------------

describe('F-P1-04 (resume) — the 5-state label rides the public list surfaces', () => {
  it('ProductCard accepts and renders priceState with its reason', () => {
    const src = readFileSync(
      join(process.cwd(), 'components/products/product-card.tsx'),
      'utf8'
    );
    expect(src).toContain('priceState?: PriceStateResult');
    expect(src).toContain('Price state:');
    expect(src).toContain('{product.priceState.label}');
    expect(src).toContain('{product.priceState.reason}');
  });

  it('the list callers pass the derived state through', () => {
    for (const file of [
      'app/products/page.tsx',
      'app/brands/[slug]/page.tsx',
      'app/categories/[slug]/page.tsx',
      'app/page.tsx',
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).toContain('priceState');
    }
  });

  it('getProducts attaches STALE to an 11-day-old unverified listing', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          {
            id: 'p1',
            name: 'MacBook Air 13',
            slug: 'macbook-air-13',
            description: 'Thin laptop.',
            brand: 'Apple',
            category: 'Laptops',
            image_url: null,
            gtin: null,
            model_number: null,
            confidence_score: 50,
            data_freshness: '2026-11-02T07:13:52.000Z',
            created_at: '2026-11-02T07:13:52.000Z',
            updated_at: '2026-11-02T07:13:52.000Z',
            status: 'published',
            price_verification_status: 'unverified',
            price_verified_at: null,
          },
        ]);
      }
      if (table === 'merchant_products') {
        return ok([
          {
            product_id: 'p1',
            merchant_id: 'm-amazon',
            price: 999,
            compare_at_price: 1099,
            price_verification_status: 'unverified',
            price_source: 'manual-intake',
            price_verified_at: null,
          },
        ]);
      }
      return ok([]);
    });
    const { products } = await getProducts(client, {});
    expect(products).toHaveLength(1);
    expect(products[0]?.priceState?.state).toBe('STALE');
    expect(products[0]?.priceState?.label).toBe('Stale');
    expect(products[0]?.priceState?.reason).toContain('never verified');
  });
});

// ---------------------------------------------------------------------------
// F-P2-03 (RESUME #2) — the legacy 50 default is gone from the
// enrich inputs too (internal only, never serialized — but the
// floor must not survive anywhere a reader could mistake it for
// a completeness score).
// ---------------------------------------------------------------------------

describe('F-P2-03 (resume) — the legacy 50 default is gone from enrich inputs too', () => {
  it('no enrich input defaults the legacy count to 50', () => {
    for (const file of [
      'services/personal-assistant.ts',
      'services/guided-finder.ts',
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).not.toContain('confidence_score ?? 50');
      expect(src).not.toContain('confidenceScore ?? 50');
    }
  });
});
