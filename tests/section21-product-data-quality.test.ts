/**
 * Sections 21–25, Stage H (H-P2-3 + H-P2-4) — the public product
 * page shows the 7-dimension data-quality score, not the
 * field-presence "confidence" percentage.
 *
 * - GET /api/v1/products/[slug] now includes `dataQuality`
 *   (score + 7 dimensions + grade + missing fields), computed
 *   server-side from the product row + context reads; a
 *   dimension with no data scores 0, never a guessed value.
 * - When the merchant `price_source` column is missing
 *   (migration 045 unapplied), the merchant read retries without
 *   it and `merchantSourceMissing: true` rides along, so the
 *   page can say the score may understate (H-P2-4).
 * - The client no longer renders a "Data completeness
 *   {confidence}%" row (source-level assertion, the same style
 *   tests/section20-catalog-surfaces.test.ts uses for this
 *   component); it renders the dataQuality row, hidden until
 *   the API fetch returns.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GET } from '@/app/api/v1/products/[slug]/route';

const state = vi.hoisted(() => ({
  merchantCalls: 0,
  merchantErrorFirst: false,
}));

const FIXTURE_PRODUCT = {
  id: 'prod-1',
  name: 'Test Laptop',
  slug: 'test-laptop',
  description: 'A test laptop',
  brand: 'TestBrand',
  category: 'laptop',
  imageUrl: null,
  gtin: null,
  confidenceScore: 50,
  // Fresh "last checked" so the freshness dimension scores 100
  // (20 points) regardless of the run date; identity adds 15
  // (name + brand + category + description) and every other
  // dimension scores 0 — the honest total for this fixture is 35.
  dataFreshness: new Date().toISOString(),
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  status: 'published',
  priceVerificationStatus: 'unverified',
  priceVerifiedAt: null,
};

const CHAIN_METHODS = ['select', 'eq', 'in', 'is', 'order', 'limit'] as const;

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => void) => {
          // First merchant_products read (with price_source)
          // fails with 42703 when the test arms it, exercising
          // the staged retry; every other read returns no rows.
          if (table === 'merchant_products' && state.merchantErrorFirst && state.merchantCalls === 0) {
            state.merchantCalls += 1;
            resolve({ data: null, error: { code: '42703', message: 'column "price_source" does not exist' } });
            return;
          }
          if (table === 'merchant_products') state.merchantCalls += 1;
          resolve({ data: [], error: null });
        },
      };
      for (const method of CHAIN_METHODS) {
        chain[method] = (..._args: unknown[]) => chain;
      }
      return chain;
    },
  }),
}));

vi.mock('@/services/products', () => ({
  getCachedProductBySlug: async () => FIXTURE_PRODUCT,
  getProductImages: async () => [],
  getProductAttributes: async () => [],
  getProductVariants: async () => [],
}));

vi.mock('@/services/repairability', () => ({
  getProductRepairability: async () => null,
}));
vi.mock('@/services/hardware-endurance', () => ({
  getProductEndurance: async () => null,
}));
vi.mock('@/services/physical-attributes', () => ({
  getProductPhysical: async () => null,
}));
vi.mock('@/services/recorded-overrides', () => ({
  getProductRecordedOverrides: async () => null,
}));
vi.mock('@/services/global-readiness', () => ({
  getProductGlobalReadiness: async () => null,
}));
vi.mock('@/services/product-dimensions', () => ({
  getProductDimensions: async () => ({ lengthCm: null, widthCm: null, heightCm: null }),
  getProductModelUrl: async () => null,
  getProductAuthenticity: async () => null,
  getProductSupplyChain: async () => null,
}));

beforeEach(() => {
  state.merchantCalls = 0;
  state.merchantErrorFirst = false;
});

function slugRequest(ip: string) {
  return new NextRequest('http://localhost/api/v1/products/test-laptop', {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

interface DataQualityBody {
  success: boolean;
  data?: {
    slug?: string;
    dataQuality?: {
      score?: number;
      grade?: string;
      dimensions?: Array<{ key?: string; label?: string; score?: number; points?: number }>;
      missingFields?: string[];
      merchantSourceMissing?: boolean;
    };
  };
}

describe('GET /api/v1/products/[slug] — dataQuality (H-P2-3)', () => {
  it('includes the 7-dimension score: 35 for a name/brand/category/description-only product', async () => {
    const res = await GET(slugRequest('203.0.113.41'), { params: { slug: 'test-laptop' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataQualityBody;
    expect(body.success).toBe(true);
    expect(body.data?.slug).toBe('test-laptop');
    const dq = body.data?.dataQuality;
    expect(dq?.score).toBe(35);
    expect(dq?.grade).toBe('poor');
    expect(dq?.dimensions).toHaveLength(7);
    expect(dq?.dimensions?.map((d) => d.key)).toEqual([
      'identity',
      'specs',
      'images',
      'priceFreshness',
      'merchants',
      'gtin',
      'attribution',
    ]);
    // Identity 15/15, freshness 20/20, everything else 0.
    expect(dq?.dimensions?.find((d) => d.key === 'identity')?.points).toBe(15);
    expect(dq?.dimensions?.find((d) => d.key === 'priceFreshness')?.points).toBe(20);
    expect(dq?.dimensions?.find((d) => d.key === 'gtin')?.points).toBe(0);
    expect(dq?.missingFields).toContain('GTIN');
    expect(dq?.merchantSourceMissing).toBe(false);
  });

  it('marks merchantSourceMissing when the price_source column is absent (H-P2-4)', async () => {
    state.merchantErrorFirst = true;
    const res = await GET(slugRequest('203.0.113.42'), { params: { slug: 'test-laptop' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DataQualityBody;
    // The retry without the column succeeded, so the response
    // still lands — with the flag so the page says the score may
    // understate instead of showing a bare number.
    expect(body.data?.dataQuality?.score).toBe(35);
    expect(body.data?.dataQuality?.merchantSourceMissing).toBe(true);
    expect(state.merchantCalls).toBe(2);
  });
});

describe('product detail client — no more "Data completeness" row (H-P2-3)', () => {
  it('renders the dataQuality row and never the confidence percentage', () => {
    const src = readFileSync(
      join(process.cwd(), 'components/products/product-detail-client.tsx'),
      'utf8'
    );
    expect(src).not.toContain('Data completeness');
    expect(src).toContain('product.dataQuality.score');
    expect(src).toContain('DATA_QUALITY_SCORE_LABEL');
    expect(src).toContain('may understate');
  });
});

describe('price history graph — recorded currency, never an assumed $ (H-P2-9)', () => {
  it('keeps the API currency on every point and formats with it', () => {
    const src = readFileSync(
      join(process.cwd(), 'components/products/price-history-graph.tsx'),
      'utf8'
    );
    // The point shape carries the currency from the API.
    expect(src).toContain('currency: string | null');
    expect(src).toContain('currency:');
    // All rendered amounts go through the currency-aware formatter.
    expect(src).toContain('formatMoney(stats.current)');
    expect(src).toContain('formatMoney(stats.lowest)');
    expect(src).toContain('formatMoney(drop.newPrice)');
    // Mixed / unrecorded currencies get an honest note, not a $.
    expect(src).toContain('multiple currencies');
    expect(src).toContain('Currency was not recorded');
    // No hard-coded dollar formatting remains on any rendered amount.
    expect(src).not.toContain('${stats.current.toFixed(2)}');
    expect(src).not.toContain('${stats.lowest.toFixed(2)}');
    expect(src).not.toContain('`$${value.toFixed(2)}`');
    expect(src).not.toContain('tickFormatter={(v: number) => `$${v}`}');
  });

  it('the /prices API already returns the currency per point', () => {
    const src = readFileSync(join(process.cwd(), 'services/price-history.ts'), 'utf8');
    expect(src).toContain('currency: row.currency');
    expect(src).toContain("'id, product_id, retailer_id, price, currency, availability, url, recorded_at'");
  });
});
