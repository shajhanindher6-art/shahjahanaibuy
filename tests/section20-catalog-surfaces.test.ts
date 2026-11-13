import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INTAKE_OPTIONAL_COLUMNS,
  normalizeGtin,
  parseIntakeCsv,
  planIntakeInsert,
  reviewIntakeRows,
  type IntakeCatalogContext,
  type IntakeRowInput,
} from '@/services/catalog-intake';
import {
  NAME_BRAND_FUZZY_THRESHOLD,
  findDuplicate,
  findDuplicateCandidates,
  nameTokenSimilarity,
  normalizeDedupeText,
  type DuplicateSweepProduct,
} from '@/services/pipeline/deduplication';
import {
  getMerchantSyncReliability,
  scoreMerchantSyncReliability,
  type MerchantSyncReliabilityInput,
} from '@/services/merchant-reliability-score';
import { getProductVariants } from '@/services/products';
import { priceVerificationForIntakeSource } from '@/services/price-verification';

// Section 20 — catalog audit surfaces: model number (#6), variants
// wiring (#8), dedupe (#9), merchant reliability from sync history
// (#10), seed idempotency (#11), CSV unverified-only workflow (#21).
// Pure-function + fake-client tests only: no DB, no network, no
// seed re-run, no invented catalog data.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

// ---------------------------------------------------------------------------
// #6 — Model number
// ---------------------------------------------------------------------------

describe('Section 20 #6 — model number field', () => {
  it('migration 055 exists, is DO NOT APPLY, and adds model_number + a partial index', () => {
    const sql = readRepoFile(
      'supabase/migrations/20261113080000_055_products_model_number.sql'
    );
    expect(sql).toContain('DO NOT APPLY');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS model_number');
    expect(sql).toContain('idx_products_model_number');
    expect(sql).toContain('WHERE model_number IS NOT NULL');
    // No UNIQUE: a model number alone does not prove identity.
    expect(sql).not.toMatch(/UNIQUE.*model_number|model_number.*UNIQUE/);
    // Never a guessed value.
    expect(sql).toContain('Never guessed');
  });

  it('model_number is an optional intake column', () => {
    expect(INTAKE_OPTIONAL_COLUMNS).toContain('model_number');
  });

  it('parseIntakeCsv reads model_number and leaves it undefined when absent', () => {
    const csv = [
      'name,slug,brand,category,price,currency,merchant,model_number',
      'Test Headphones,test-headphones,TestBrand,Audio,49.99,USD,amazon,TH-2026',
      'Other Headphones,other-headphones,TestBrand,Audio,29.99,USD,amazon,',
    ].join('\n');
    const { rows, headerErrors } = parseIntakeCsv(csv);
    expect(headerErrors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].modelNumber).toBe('TH-2026');
    expect(rows[1].modelNumber).toBeUndefined();
  });

  it('review + plan carry model_number through to the insert payload', () => {
    const context: IntakeCatalogContext = {
      existingSlugs: new Set(),
      existingNameBrands: new Map(),
      knownMerchants: new Map([['amazon', 'merchant-amazon']]),
      knownCurrencies: new Map([['USD', 'currency-usd']]),
    };
    const rows: IntakeRowInput[] = [
      {
        rowNumber: 2,
        name: 'Test Headphones',
        slug: 'test-headphones',
        brand: 'TestBrand',
        category: 'Audio',
        price: '49.99',
        currency: 'USD',
        merchant: 'amazon',
        modelNumber: 'TH-2026',
      },
    ];
    const review = reviewIntakeRows(rows, context);
    expect(review.rows[0].status).toBe('valid');
    expect(review.rows[0].data?.modelNumber).toBe('TH-2026');
    const plans = planIntakeInsert(review.rows);
    expect(plans).toHaveLength(1);
    expect(plans[0].product.model_number).toBe('TH-2026');
  });

  it('a row without model_number plans without the column (honest empty state)', () => {
    const context: IntakeCatalogContext = {
      existingSlugs: new Set(),
      existingNameBrands: new Map(),
      knownMerchants: new Map([['amazon', 'merchant-amazon']]),
      knownCurrencies: new Map([['USD', 'currency-usd']]),
    };
    const rows: IntakeRowInput[] = [
      {
        rowNumber: 2,
        name: 'Test Headphones',
        slug: 'test-headphones',
        brand: 'TestBrand',
        category: 'Audio',
        price: '49.99',
        currency: 'USD',
        merchant: 'amazon',
      },
    ];
    const plans = planIntakeInsert(reviewIntakeRows(rows, context).rows);
    expect(plans).toHaveLength(1);
    expect(plans[0].product.model_number).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #8 — Variants wiring (service level; the API route + detail page
// render the returned array only when it is non-empty)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Minimal thenable query builder: every chain call returns this. */
class FakeBuilder {
  error: { code?: string; message: string } | null = null;

  constructor(
    private rows: Row[],
    private table: string
  ) {}

  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  is(): this {
    return this;
  }
  ilike(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
    if (this.error) return Promise.resolve({ data: null, error: this.error });
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then(
    onFulfilled: (value: { data: Row[] | null; error: { message: string } | null }) => unknown
  ): Promise<unknown> {
    return Promise.resolve({
      data: this.error ? null : this.rows,
      error: this.error,
    }).then(onFulfilled);
  }
}

function fakeClientFor(tables: Record<string, Row[]>, errors: Record<string, { code?: string; message: string }> = {}) {
  return {
    from(table: string) {
      const builder = new FakeBuilder(tables[table] ?? [], table);
      if (errors[table]) builder.error = errors[table];
      return builder;
    },
  };
}

describe('Section 20 #8 — getProductVariants', () => {
  const variantRows: Row[] = [
    {
      id: 'v-1',
      product_id: 'p-1',
      name: '256 GB',
      sku: 'SKU-256',
      attributes: { storage: '256 GB' },
      image_url: null,
      in_stock: true,
      sort_order: 1,
      active: true,
    },
    {
      id: 'v-2',
      product_id: 'p-1',
      name: '512 GB',
      sku: null,
      attributes: { storage: '512 GB' },
      image_url: null,
      in_stock: false,
      sort_order: 2,
      active: true,
    },
  ];

  it('maps variant rows to camelCase domain objects', async () => {
    const client = fakeClientFor({ product_variants: variantRows });
    const variants = await getProductVariants(
      client as unknown as Parameters<typeof getProductVariants>[0],
      'p-1'
    );
    expect(variants).toHaveLength(2);
    expect(variants[0]).toEqual({
      id: 'v-1',
      productId: 'p-1',
      name: '256 GB',
      sku: 'SKU-256',
      attributes: { storage: '256 GB' },
      imageUrl: null,
      inStock: true,
      sortOrder: 1,
      active: true,
    });
    expect(variants[1].inStock).toBe(false);
    expect(variants[1].sku).toBeNull();
  });

  it('returns [] on a query error instead of throwing (fail-safe read)', async () => {
    const client = fakeClientFor(
      {},
      { product_variants: { message: 'relation does not exist' } }
    );
    const variants = await getProductVariants(
      client as unknown as Parameters<typeof getProductVariants>[0],
      'p-1'
    );
    expect(variants).toEqual([]);
  });

  it('returns [] when the product has no variants (the live state: 0 rows)', async () => {
    const client = fakeClientFor({ product_variants: [] });
    const variants = await getProductVariants(
      client as unknown as Parameters<typeof getProductVariants>[0],
      'p-1'
    );
    expect(variants).toEqual([]);
  });

  it('the [slug] API route fetches and returns variants', () => {
    const route = readRepoFile('app/api/v1/products/[slug]/route.ts');
    expect(route).toContain('getProductVariants');
    expect(route).toContain('variants,');
    expect(route).toContain('...product, images, attributes, variants,');
  });

  it('the detail page renders a variant selector only when variants exist', () => {
    const page = readRepoFile('components/products/product-detail-client.tsx');
    expect(page).toContain('variants.length > 0');
    expect(page).toContain('product-variant');
    // Model number row is hidden by SpecRow when null (honest empty state).
    expect(page).toContain('Model number');
    expect(page).toContain('product.modelNumber ?? null');
  });
});

// ---------------------------------------------------------------------------
// #9 — Dedupe: fuzzy name/brand leg + retroactive sweep
// ---------------------------------------------------------------------------

describe('Section 20 #9 — dedupe helpers', () => {
  it('normalizeDedupeText lower-cases and collapses punctuation', () => {
    expect(normalizeDedupeText('MacBook  Air 13-inch!')).toBe('macbook air 13 inch');
  });

  it('nameTokenSimilarity is order-free and 1 for identical token sets', () => {
    expect(nameTokenSimilarity('MacBook Air 13', 'Air 13 MacBook')).toBe(1);
    // {macbook, air, 13} vs {macbook, pro, 13}: 2 shared of 4.
    expect(nameTokenSimilarity('MacBook Air 13', 'MacBook Pro 13')).toBe(0.5);
    expect(nameTokenSimilarity('MacBook Air 13', 'MacBook Air 13-inch')).toBeCloseTo(0.75);
  });

  it('normalizeGtin strips spaces/hyphens so formatting cannot hide a match', () => {
    expect(normalizeGtin('978-0-123')).toBe('9780123');
    expect(normalizeGtin(' 978 0123 ')).toBe('9780123');
  });
});

describe('Section 20 #9 — findDuplicateCandidates (retroactive sweep)', () => {
  const product = (overrides: Partial<DuplicateSweepProduct>): DuplicateSweepProduct => ({
    id: 'p-1',
    slug: 'macbook-air-13',
    name: 'MacBook Air 13',
    brand: 'Apple',
    gtin: null,
    ...overrides,
  });

  it('same GTIN under a different slug is a confidence-1 GTIN candidate', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'macbook-air-13', gtin: '9780123' }),
      product({ id: 'p-2', slug: 'macbook-air-13-copy', name: 'MacBook Air 13 (2024)', gtin: '978-0-123' }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      productId: 'p-2',
      productSlug: 'macbook-air-13-copy',
      duplicateOfProductId: 'p-1',
      duplicateOfSlug: 'macbook-air-13',
      matchedBy: 'gtin',
      confidence: 1,
    });
    expect(candidates[0].reasons.join(' ')).toContain('GTIN');
  });

  it('same normalized name + brand is a confidence-1 name-brand candidate', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'macbook-air-13' }),
      product({ id: 'p-2', slug: 'macbook-air-13-new', name: 'macbook  air 13' }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ matchedBy: 'name-brand', confidence: 1 });
  });

  it('a reworded name under the same brand is a fuzzy candidate at/above the threshold', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'macbook-air-13' }),
      product({ id: 'p-2', slug: 'macbook-air-13-inch', name: 'MacBook Air 13-inch' }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchedBy).toBe('name-brand-fuzzy');
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(NAME_BRAND_FUZZY_THRESHOLD);
    expect(candidates[0].confidence).toBeLessThan(1);
  });

  it('distinct models under the same brand are NOT candidates', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'macbook-air-13' }),
      product({ id: 'p-2', slug: 'macbook-pro-13', name: 'MacBook Pro 13' }),
    ]);
    expect(candidates).toEqual([]);
  });

  it('the same name under a different brand is NOT a candidate', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'air-13', name: 'Air 13', brand: 'Apple' }),
      product({ id: 'p-2', slug: 'air-13-x', name: 'Air 13', brand: 'OtherBrand' }),
    ]);
    expect(candidates).toEqual([]);
  });

  it('a shared model number alone never creates a candidate', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'phone-a', name: 'Phone A', brand: 'BrandX', modelNumber: 'X-100' }),
      product({ id: 'p-2', slug: 'phone-b', name: 'Phone B', brand: 'BrandX', modelNumber: 'X-100' }),
    ]);
    expect(candidates).toEqual([]);
  });

  it('a pair matching on GTIN and name is reported once, as a GTIN match', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'macbook-air-13', gtin: '9780123' }),
      product({ id: 'p-2', slug: 'macbook-air-13-copy', gtin: '9780123' }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].matchedBy).toBe('gtin');
  });

  it('returns [] for an empty catalog and for the live 10-product catalog shape', () => {
    expect(findDuplicateCandidates([])).toEqual([]);
    const live: DuplicateSweepProduct[] = [
      ['galaxy-s24-ultra', 'Galaxy S24 Ultra', 'Samsung'],
      ['sony-wh-1000xm5', 'Sony WH-1000XM5', 'Sony'],
      ['dell-xps-13', 'Dell XPS 13', 'Dell'],
      ['lenovo-thinkpad-x1', 'Lenovo ThinkPad X1', 'Lenovo'],
      ['bose-quietcomfort-ultra', 'Bose QuietComfort Ultra', 'Bose'],
      ['canon-eos-r10', 'Canon EOS R10', 'Canon'],
      ['gopro-hero12', 'GoPro Hero12', 'GoPro'],
      ['garmin-venu-3', 'Garmin Venu 3', 'Garmin'],
      ['logitech-mx-master-3s', 'Logitech MX Master 3S', 'Logitech'],
      ['macbook-air-13', 'MacBook Air 13', 'Apple'],
    ].map(([slug, name, brand], i) => ({
      id: `p-${i}`,
      slug,
      name,
      brand,
      gtin: null,
    }));
    expect(findDuplicateCandidates(live)).toEqual([]);
  });

  it('candidates sort by confidence descending (exact first)', () => {
    const candidates = findDuplicateCandidates([
      product({ id: 'p-1', slug: 'macbook-air-13' }),
      product({ id: 'p-2', slug: 'macbook-air-13-inch', name: 'MacBook Air 13-inch' }),
      product({ id: 'p-3', slug: 'macbook-air-13-copy', gtin: '9780123' }),
      product({ id: 'p-4', slug: 'macbook-air-13-gtin', name: 'MacBook Air 13', gtin: '9780123' }),
    ]);
    expect(candidates[0].confidence).toBe(1);
    expect(candidates[candidates.length - 1].matchedBy).toBe('name-brand-fuzzy');
  });
});

describe('Section 20 #9 — intake GTIN leg (same GTIN, different slug)', () => {
  const context = (overrides: Partial<IntakeCatalogContext> = {}): IntakeCatalogContext => ({
    existingSlugs: new Set(['macbook-air-13']),
    existingNameBrands: new Map([['macbook air 13|apple', 'macbook-air-13']]),
    existingGtins: new Map([['4006381333931', 'macbook-air-13']]),
    knownMerchants: new Map([['amazon', 'merchant-amazon']]),
    knownCurrencies: new Map([['USD', 'currency-usd']]),
    ...overrides,
  });

  const row = (overrides: Partial<IntakeRowInput> = {}): IntakeRowInput => ({
    rowNumber: 2,
    name: 'MacBook Air 13 (2024)',
    slug: 'macbook-air-13-2024',
    brand: 'Apple',
    category: 'Laptops',
    price: '999',
    currency: 'USD',
    merchant: 'amazon',
    gtin: '4006381333931',
    ...overrides,
  });

  it('same GTIN under a different slug is near-duplicate, never valid', () => {
    const review = reviewIntakeRows([row()], context());
    expect(review.rows[0].status).toBe('near-duplicate');
    expect(review.rows[0].nearDuplicateOf).toBe('macbook-air-13');
    expect(review.rows[0].duplicateDetail).toContain('Same GTIN');
    expect(review.rows[0].duplicateDetail).toContain('macbook-air-13');
    expect(review.summary.valid).toBe(0);
  });

  it('GTIN formatting differences do not hide the match', () => {
    const review = reviewIntakeRows([row({ gtin: '4006-3813-3393-1' })], context());
    expect(review.rows[0].status).toBe('near-duplicate');
  });

  it('a repeated GTIN inside one file flags the second row', () => {
    const review = reviewIntakeRows(
      [row({ slug: 'a-one', gtin: '5901234123457' }), row({ rowNumber: 3, slug: 'a-two', gtin: '5901234123457' })],
      context()
    );
    expect(review.rows[0].status).toBe('valid');
    expect(review.rows[1].status).toBe('near-duplicate');
    expect(review.rows[1].duplicateDetail).toContain('row 2 in this file');
  });

  it('a context without existingGtins (older caller) does not crash and stays valid', () => {
    const { existingGtins: _dropped, ...legacy } = context();
    void _dropped;
    const review = reviewIntakeRows([row()], legacy);
    expect(review.rows[0].status).toBe('valid');
  });

  it('the intake route loads GTINs into the context', () => {
    const route = readRepoFile('app/api/v1/admin/intake/route.ts');
    expect(route).toContain("select('slug, name, brand, gtin')");
    expect(route).toContain('existingGtins');
    expect(route).toContain('normalizeGtin');
    expect(route).toContain('modelNumberUnsupported');
  });
});

describe('Section 20 #9 — findDuplicate pipeline legs', () => {
  /** Fake client: GTIN/slug lookups via maybeSingle, brand leg via a thenable. */
  function pipelineClient(options: {
    gtinHit?: boolean;
    slugHit?: boolean;
    brandRows?: Row[];
    brandError?: boolean;
  }) {
    return {
      from(table: string) {
        void table;
        return new (class extends FakeBuilder {
          maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
            if (table === 'products' && options.gtinHit) {
              return Promise.resolve({ data: { id: 'existing-gtin' }, error: null });
            }
            if (table === 'products' && options.slugHit) {
              return Promise.resolve({ data: { id: 'existing-slug' }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }
          then(
            onFulfilled: (value: { data: Row[] | null; error: { message: string } | null }) => unknown
          ): Promise<unknown> {
            if (options.brandError) {
              return Promise.resolve({
                data: null,
                error: { message: 'brand query failed' },
              }).then(onFulfilled);
            }
            return Promise.resolve({
              data: options.brandRows ?? [],
              error: null,
            }).then(onFulfilled);
          }
        })([], table);
      },
    };
  }

  const normalized = {
    name: 'MacBook Air 13',
    slug: 'macbook-air-13-new',
    description: null,
    brand: 'Apple',
    category: 'Laptops',
    imageUrl: null,
    gtin: null,
    confidenceScore: 50,
    images: [],
    price: 999,
    currency: 'USD',
    availability: 'in_stock',
    url: null,
    externalId: 'ext-1',
    retailerSlug: 'amazon',
    raw: undefined,
  };

  it('GTIN match wins (same GTIN, different slug)', async () => {
    const client = pipelineClient({ gtinHit: true });
    const result = await findDuplicate(
      client as unknown as Parameters<typeof findDuplicate>[0],
      { ...normalized, gtin: '9780123' }
    );
    expect(result).toMatchObject({ isDuplicate: true, matchedBy: 'gtin', confidence: 1 });
  });

  it('exact normalized name+brand matches when GTIN and slug do not', async () => {
    const client = pipelineClient({
      brandRows: [{ id: 'existing-name', name: 'macbook  air 13', brand: 'apple' }],
    });
    const result = await findDuplicate(
      client as unknown as Parameters<typeof findDuplicate>[0],
      normalized
    );
    expect(result).toMatchObject({ isDuplicate: true, matchedBy: 'name-brand', confidence: 1 });
  });

  it('a reworded name under the same brand is a fuzzy match', async () => {
    const client = pipelineClient({
      brandRows: [{ id: 'existing-fuzzy', name: 'MacBook Air 13-inch', brand: 'Apple' }],
    });
    const result = await findDuplicate(
      client as unknown as Parameters<typeof findDuplicate>[0],
      normalized
    );
    expect(result).toMatchObject({ isDuplicate: true, matchedBy: 'name-brand-fuzzy' });
    expect(result.confidence ?? 0).toBeGreaterThanOrEqual(NAME_BRAND_FUZZY_THRESHOLD);
  });

  it('a distinct model under the same brand is not a duplicate', async () => {
    const client = pipelineClient({
      brandRows: [{ id: 'other', name: 'MacBook Pro 13', brand: 'Apple' }],
    });
    const result = await findDuplicate(
      client as unknown as Parameters<typeof findDuplicate>[0],
      normalized
    );
    expect(result.isDuplicate).toBe(false);
  });

  it('a failing brand-leg query degrades to no match instead of throwing', async () => {
    const client = pipelineClient({ brandError: true });
    const result = await findDuplicate(
      client as unknown as Parameters<typeof findDuplicate>[0],
      normalized
    );
    expect(result.isDuplicate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #10 — Merchant reliability from sync history
// ---------------------------------------------------------------------------

describe('Section 20 #10 — scoreMerchantSyncReliability', () => {
  const base: MerchantSyncReliabilityInput = {
    merchantId: 'm-amazon',
    merchantName: 'Amazon',
    runs: [
      { status: 'completed', startedAt: '2026-11-13T06:00:00Z' },
      { status: 'completed', startedAt: '2026-11-13T00:00:00Z' },
    ],
    totalListings: 10,
    freshListings: 10,
    lastSyncedAt: '2026-11-13T06:00:00Z',
  };

  it('no refresh runs at all → insufficient data, never a guessed score', () => {
    const result = scoreMerchantSyncReliability({ ...base, runs: [] });
    expect(result.score).toBeNull();
    expect(result.status).toBe('insufficient-data');
    expect(result.notEnoughData).toBe(true);
    expect(result.level).toBe('unknown');
    expect(result.explanation).toContain('migration 040');
  });

  it('runs recorded but no live listings → insufficient data', () => {
    const result = scoreMerchantSyncReliability({
      ...base,
      totalListings: 0,
      freshListings: 0,
      lastSyncedAt: null,
    });
    expect(result.score).toBeNull();
    expect(result.status).toBe('insufficient-data');
    expect(result.explanation).toContain('no live listings');
  });

  it('all runs completed + all listings fresh → 100 (high)', () => {
    const result = scoreMerchantSyncReliability(base);
    expect(result.score).toBe(100);
    expect(result.level).toBe('high');
    expect(result.status).toBe('scored');
    expect(result.runsConsidered).toBe(2);
    expect(result.runSuccessRate).toBe(1);
  });

  it('half the runs failed + 2 of 5 listings fresh → 55 (medium)', () => {
    const result = scoreMerchantSyncReliability({
      ...base,
      runs: [
        { status: 'completed', startedAt: '2026-11-13T06:00:00Z' },
        { status: 'failed', startedAt: '2026-11-13T00:00:00Z' },
      ],
      totalListings: 5,
      freshListings: 2,
    });
    // Fresh 2/5 → 20 pts, depth 5+ → 20 pts, run health 50% → 15 pts.
    expect(result.score).toBe(55);
    expect(result.level).toBe('medium');
  });

  it('stale listings (0 fresh) score 0 on the freshness leg and say so', () => {
    const result = scoreMerchantSyncReliability({
      ...base,
      freshListings: 0,
      lastSyncedAt: '2026-11-02T07:13:52Z',
    });
    // Fresh 0 + depth 20 + run health 30 = 50.
    expect(result.score).toBe(50);
    expect(result.explanation).toContain('0 of 10 listings synced in the last 7 days');
  });

  it('completed_with_failures counts as half healthy', () => {
    const result = scoreMerchantSyncReliability({
      ...base,
      runs: [{ status: 'completed_with_failures', startedAt: '2026-11-13T06:00:00Z' }],
    });
    expect(result.runSuccessRate).toBe(0.5);
    // Fresh 50 + depth 20 + run health 15 = 85.
    expect(result.score).toBe(85);
  });

  it('getMerchantSyncReliability: a missing price_refresh_runs table (040 unapplied) → insufficient data', async () => {
    const client = fakeClientFor(
      { merchant_products: [] },
      { price_refresh_runs: { code: 'PGRST205', message: 'table not found' } }
    );
    const result = await getMerchantSyncReliability(
      client as unknown as Parameters<typeof getMerchantSyncReliability>[0],
      'm-amazon',
      'Amazon'
    );
    expect(result.score).toBeNull();
    expect(result.status).toBe('insufficient-data');
    expect(result.runsConsidered).toBe(0);
  });

  it('getMerchantSyncReliability: runs + fresh listings → a real score', async () => {
    const now = new Date().toISOString();
    const client = fakeClientFor({
      price_refresh_runs: [
        { status: 'completed', started_at: now },
        { status: 'completed', started_at: now },
      ],
      merchant_products: [
        { last_synced_at: now },
        { last_synced_at: now },
        { last_synced_at: now },
        { last_synced_at: now },
        { last_synced_at: now },
      ],
    });
    const result = await getMerchantSyncReliability(
      client as unknown as Parameters<typeof getMerchantSyncReliability>[0],
      'm-amazon',
      'Amazon'
    );
    expect(result.score).toBe(100);
    expect(result.level).toBe('high');
    expect(result.totalListings).toBe(5);
    expect(result.freshListings).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// #11 — Seed idempotency (static guards; the seed is never re-run here)
// ---------------------------------------------------------------------------

describe('Section 20 #11 — seed idempotency guards', () => {
  const seed = readRepoFile('supabase/seed-demo-data.sql');

  it('price_history, deals and cashback inserts all carry NOT EXISTS guards', () => {
    expect(seed).toContain('FROM price_history ph');
    expect(seed).toContain('FROM deals x');
    expect(seed).toContain('FROM cashback_offers x');
    expect(seed).toContain('NOT EXISTS');
  });

  it('the header no longer claims the seed duplicates on re-run', () => {
    expect(seed).not.toContain('are NOT\n--     deduplicated');
    expect(seed).toContain('safe to re-run');
  });

  it('coupons stay idempotent via ON CONFLICT (code)', () => {
    expect(seed).toContain('ON CONFLICT (code) DO NOTHING');
  });
});

// ---------------------------------------------------------------------------
// #21 — CSV unverified-only workflow
// ---------------------------------------------------------------------------

describe('Section 20 #21 — CSV rows default to unverified', () => {
  it('manual-intake prices are unverified by definition, with no verified_at', () => {
    const verification = priceVerificationForIntakeSource(
      'manual-intake',
      '2026-11-13T08:00:00Z'
    );
    expect(verification).toEqual({
      priceVerificationStatus: 'unverified',
      priceSource: 'manual-intake',
      priceVerifiedAt: null,
    });
  });

  it('the intake UI says plainly that CSV rows are unverified and do not count toward the 50 verified', () => {
    const page = readRepoFile('app/admin/intake/page.tsx');
    expect(page).toContain('unverified — they do not count toward the 50 verified products');
    expect(page).toContain('Manual CSV can add unlimited unverified rows only (max 1,000 per batch)');
    expect(page).toContain('does not count toward the 50 verified products');
  });

  it('the intake API stamps the manual-intake verification on approve', () => {
    const route = readRepoFile('app/api/v1/admin/intake/route.ts');
    expect(route).toContain('priceVerificationForIntakeSource');
    expect(route).toContain("source: INTAKE_SOURCE");
  });
});
