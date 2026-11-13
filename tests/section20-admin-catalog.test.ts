/**
 * Section 20, §12 #66/#68/#69/#70/#71/#85 — admin catalog +
 * data-quality score tests.
 *
 * Pure-service tests against fake Supabase clients (no DB, no
 * network): the transparent data-quality scorer (no 50-floor, GTIN
 * check digit, stale-price dimension), the verified → stale flip
 * (predicate + writer + its fail-safe when migration 045 is
 * unapplied), the refresh step's stale flip count, admin product
 * list/get/update/delete validation, the duplicate-candidate
 * pipeline sweep (GTIN / name+brand / fuzzy) plus its fallback
 * scan, the missing-specs / image-status / price-history
 * review reads, and the /admin/ai data-quality summary.
 *
 * The pages themselves are server components under the admin
 * layout guard and are not rendered here; their logic lives in
 * services/admin-products.ts and services/admin-data-quality.ts.
 * The manual refresh button posts to /api/v1/prices/refresh with
 * the admin session — its auth (cron first, admin fallback) is
 * the same pattern predictions/outcomes + uptime/check already
 * use, and is verified live, not by a unit test.
 */
import { describe, expect, it } from 'vitest';
import {
  DATA_QUALITY_SCORE_LABEL,
  computeProductQualityScore,
  isValidGtin,
  isValidImageUrl,
  type QualityScoreContext,
  type QualityScoreProductInput,
} from '@/services/product-quality-score';
import {
  flipStaleVerificationStatuses,
  shouldFlipVerifiedToStale,
} from '@/services/price-verification';
import { refreshTrackedPrices } from '@/services/price-refresh';
import {
  deleteAdminProduct,
  getAdminProductPriceHistory,
  listDuplicateCandidates,
  listProductImageStatus,
  listProductsMissingSpecs,
  listProductsPriceHistorySummary,
  listAdminProducts,
  scanDuplicateCandidates,
  updateAdminProduct,
  validateAdminProductPatch,
} from '@/services/admin-products';
import { getAdminDataQualitySummary } from '@/services/admin-data-quality';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// Fake Supabase client: every builder method returns the same
// thenable chain, so `await` at any point resolves to the
// configured result for that table.
// ---------------------------------------------------------------------------

type FakeResult = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };

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
  'update',
  'insert',
  'delete',
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

function ok(data: unknown, count?: number): FakeResult {
  return { data, error: null, count: count ?? (Array.isArray(data) ? data.length : null) };
}

function err(code: string, message: string): FakeResult {
  return { data: null, error: { code, message } };
}

// ---------------------------------------------------------------------------
// #66 — data-quality score
// ---------------------------------------------------------------------------

describe('computeProductQualityScore', () => {
  const fresh = new Date('2026-11-13T08:00:00.000Z');
  const freshIso = '2026-11-12T08:00:00.000Z';

  function fullProduct(): QualityScoreProductInput {
    return {
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      brand: 'Apple',
      category: 'Laptops',
      description: 'Thin and light laptop.',
      imageUrl: 'https://example.com/macbook.jpg',
      gtin: '4006381333931',
      priceVerificationStatus: 'verified',
      priceVerifiedAt: freshIso,
      dataFreshness: freshIso,
    };
  }

  function fullContext(): QualityScoreContext {
    return {
      specCount: 6,
      imageCount: 2,
      merchantCount: 2,
      inStockMerchantCount: 2,
      priceSource: 'ebay-browse-api',
      lastPriceRecordedAt: freshIso,
    };
  }

  it('scores a complete, fresh, verified record high and lists nothing missing', () => {
    const score = computeProductQualityScore(fullProduct(), fullContext(), fresh);
    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.grade).toBe('good');
    expect(score.missingFields).toEqual([]);
    expect(score.priceVerificationStatus).toBe('verified');
    expect(score.priceAgeDays).toBe(1);
  });

  it('has NO floor: a name-only record scores below 50', () => {
    const score = computeProductQualityScore({ name: 'Widget', slug: 'widget' }, {}, fresh);
    expect(score.score).toBeLessThan(50);
    expect(score.grade).toBe('poor');
    expect(score.missingFields).toContain('GTIN');
    expect(score.missingFields).toContain('specs');
    expect(score.missingFields).toContain('image URL');
    expect(score.missingFields).toContain('recent price check');
    expect(score.missingFields).toContain('merchant listings');
  });

  it('labels itself a DATA-quality score, never a product-quality score', () => {
    expect(DATA_QUALITY_SCORE_LABEL).toBe('Data quality score');
    expect(DATA_QUALITY_SCORE_LABEL.toLowerCase()).not.toContain('product quality');
  });

  it('scores the price-freshness dimension from the last check age', () => {
    const base = fullProduct();
    const stale8 = computeProductQualityScore(
      { ...base, priceVerifiedAt: '2026-11-04T08:00:00.000Z', dataFreshness: '2026-11-04T08:00:00.000Z' },
      { ...fullContext(), lastPriceRecordedAt: '2026-11-04T08:00:00.000Z' },
      fresh
    );
    const freshness8 = stale8.dimensions.find((d) => d.key === 'priceFreshness');
    expect(freshness8?.score).toBe(50);
    expect(stale8.priceAgeDays).toBe(9);

    const stale60 = computeProductQualityScore(
      { ...base, priceVerifiedAt: '2026-09-14T08:00:00.000Z', dataFreshness: '2026-09-14T08:00:00.000Z' },
      { ...fullContext(), lastPriceRecordedAt: '2026-09-14T08:00:00.000Z' },
      fresh
    );
    expect(stale60.dimensions.find((d) => d.key === 'priceFreshness')?.score).toBe(20);
  });

  it('scores an unknown price age as 0, never as fresh', () => {
    const score = computeProductQualityScore(
      { ...fullProduct(), priceVerifiedAt: null, dataFreshness: null },
      { ...fullContext(), lastPriceRecordedAt: null },
      fresh
    );
    expect(score.dimensions.find((d) => d.key === 'priceFreshness')?.score).toBe(0);
    expect(score.priceAgeDays).toBeNull();
  });
});

describe('isValidGtin', () => {
  it('accepts a valid GTIN-13 check digit and rejects a bad one', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
  });

  it('accepts GTIN-8 / GTIN-12 / GTIN-14 shapes with valid digits', () => {
    expect(isValidGtin('96385074')).toBe(true); // valid GTIN-8
    expect(isValidGtin('96385075')).toBe(false);
    expect(isValidGtin('012345678905')).toBe(true); // valid GTIN-12
  });

  it('rejects short, long, non-digit, and empty values', () => {
    expect(isValidGtin('123')).toBe(false);
    expect(isValidGtin('40063813339312')).toBe(false);
    expect(isValidGtin('400638133393A')).toBe(false);
    expect(isValidGtin('')).toBe(false);
    expect(isValidGtin(null)).toBe(false);
    expect(isValidGtin(undefined)).toBe(false);
  });
});

describe('isValidImageUrl', () => {
  it('accepts http(s) and rejects data:, javascript:, and relative URLs', () => {
    expect(isValidImageUrl('https://example.com/a.jpg')).toBe(true);
    expect(isValidImageUrl('http://example.com/a.jpg')).toBe(true);
    expect(isValidImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
    expect(isValidImageUrl('/images/a.jpg')).toBe(false);
    expect(isValidImageUrl(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #68 — verified → stale
// ---------------------------------------------------------------------------

describe('shouldFlipVerifiedToStale', () => {
  const now = new Date('2026-11-13T08:00:00.000Z');

  it('flips a verified price older than STALE_PRICE_DAYS (7)', () => {
    expect(shouldFlipVerifiedToStale('verified', '2026-11-04T08:00:00.000Z', now)).toBe(true);
  });

  it('does not flip at exactly 7 days or fresher', () => {
    expect(shouldFlipVerifiedToStale('verified', '2026-11-06T08:00:00.000Z', now)).toBe(false);
    expect(shouldFlipVerifiedToStale('verified', '2026-11-12T08:00:00.000Z', now)).toBe(false);
  });

  it('never flips unverified or stale rows', () => {
    expect(shouldFlipVerifiedToStale('unverified', '2026-10-01T08:00:00.000Z', now)).toBe(false);
    expect(shouldFlipVerifiedToStale('stale', '2026-10-01T08:00:00.000Z', now)).toBe(false);
    expect(shouldFlipVerifiedToStale(null, null, now)).toBe(false);
  });

  it('flips a verified stamp with no check date, or an unparseable one (FINAL 100%, F-P1-01)', () => {
    // A dateless verified stamp used to be verified forever: the
    // old predicate returned false for a null age and the SQL
    // `.lt(cutoff)` could never match a NULL verified_at. The
    // currency of a check that cannot be dated cannot be proven,
    // so the stamp lapses to stale instead.
    expect(shouldFlipVerifiedToStale('verified', null, now)).toBe(true);
    expect(shouldFlipVerifiedToStale('verified', 'not-a-date', now)).toBe(true);
  });
});

describe('flipStaleVerificationStatuses', () => {
  it('flips verified products and merchant rows older than the cutoff, plus dateless ones (F-P1-01)', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') return ok([{ id: 'p1' }, { id: 'p2' }]);
      if (table === 'merchant_products') return ok([{ id: 'm1' }]);
      return ok([]);
    });
    const result = await flipStaleVerificationStatuses(client, new Date('2026-11-13T08:00:00.000Z'));
    // The fake returns the same rows for BOTH passes (dated-old
    // via `.lt(cutoff)` AND dateless via `.is(price_verified_at,
    // null)`), so the counts are 2+2 products and 1+1 merchant
    // rows. The per-row distinction — an old row AND a dateless
    // row each flip exactly once — is pinned precisely in
    // tests/final100-verification-spine.test.ts.
    expect(result.flippedProducts).toBe(4);
    expect(result.flippedMerchantRows).toBe(2);
    expect(result.columnsMissing).toBe(false);
  });

  it('reports columnsMissing (never throws) when migration 045 is unapplied', async () => {
    const client = fakeClient(() => err('42703', 'column "price_verification_status" does not exist'));
    const result = await flipStaleVerificationStatuses(client);
    expect(result.columnsMissing).toBe(true);
    expect(result.flippedProducts).toBe(0);
    expect(result.flippedMerchantRows).toBe(0);
  });

  it('reports a non-missing-column error without throwing', async () => {
    const client = fakeClient(() => err('42501', 'permission denied'));
    const result = await flipStaleVerificationStatuses(client);
    expect(result.columnsMissing).toBe(false);
    expect(result.error).toContain('permission denied');
  });
});

describe('refreshTrackedPrices stale flip (#68 wiring)', () => {
  it('flips stale verifications even when no product is tracked', async () => {
    const client = fakeClient((table) => {
      if (table === 'alerts') return ok([]);
      if (table === 'wishlist_items') return ok([]);
      if (table === 'products') return ok([{ id: 'p1' }, { id: 'p2' }]);
      if (table === 'merchant_products') return ok([{ id: 'm1' }]);
      return ok([]);
    });
    const result = await refreshTrackedPrices(client);
    expect(result.tracked).toBe(0);
    // 3 rows per pass (2 products + 1 merchant row) × 2 passes
    // (dated-old + dateless, F-P1-01) — the fake returns the same
    // rows for both passes; see the flipStaleVerificationStatuses
    // test above.
    expect(result.staleFlipped).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// #69 — admin product list / patch validation / update / delete
// ---------------------------------------------------------------------------

function adminRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prod-1',
    name: 'MacBook Air 13',
    slug: 'macbook-air-13',
    description: 'Thin laptop.',
    brand: 'Apple',
    category: 'Laptops',
    image_url: null,
    gtin: null,
    confidence_score: 50,
    data_freshness: '2026-11-02T07:13:52.000Z',
    created_at: '2026-11-02T07:13:52.000Z',
    updated_at: '2026-11-02T07:13:52.000Z',
    status: 'published',
    price_verification_status: 'unverified',
    price_verified_at: null,
    ...overrides,
  };
}

describe('listAdminProducts', () => {
  it('lists all products with verification + status mapped', async () => {
    const client = fakeClient((table) =>
      table === 'products' ? ok([adminRow(), adminRow({ id: 'prod-2', name: 'Galaxy S24 Ultra', slug: 'galaxy-s24-ultra' })], 2) : ok([])
    );
    const result = await listAdminProducts(client, { page: 1, pageSize: 20 });
    expect(result.total).toBe(2);
    expect(result.products).toHaveLength(2);
    expect(result.products[0]?.status).toBe('published');
    expect(result.products[0]?.priceVerificationStatus).toBe('unverified');
    expect(result.columnsMissing).toBe(false);
  });

  it('falls back to the legacy column list on 42703 and reports columnsMissing', async () => {
    let calls = 0;
    const client = fakeClient((table) => {
      if (table !== 'products') return ok([]);
      calls += 1;
      if (calls === 1) return err('42703', 'column "status" does not exist');
      return ok([adminRow()], 1);
    });
    const result = await listAdminProducts(client, {});
    expect(result.columnsMissing).toBe(true);
    expect(result.products).toHaveLength(1);
    // Legacy rows predate 045: they read as published / unverified.
    expect(result.products[0]?.status).toBe('published');
    expect(result.products[0]?.priceVerificationStatus).toBe('unverified');
  });
});

describe('validateAdminProductPatch', () => {
  it('accepts a valid patch', () => {
    const result = validateAdminProductPatch({ name: 'New name', brand: 'Acme' });
    expect(result.error).toBeUndefined();
    expect(result.patch).toEqual({ name: 'New name', brand: 'Acme' });
  });

  it('rejects unknown fields', () => {
    const result = validateAdminProductPatch({ price: 9.99 });
    expect(result.error).toContain('cannot be edited');
  });

  it('rejects data: and javascript: image URLs, accepts https:', () => {
    expect(validateAdminProductPatch({ image_url: 'data:image/png;base64,AAAA' }).error).toContain('http(s)');
    expect(validateAdminProductPatch({ image_url: 'javascript:alert(1)' }).error).toContain('http(s)');
    expect(validateAdminProductPatch({ image_url: 'https://example.com/a.jpg' }).error).toBeUndefined();
    expect(validateAdminProductPatch({ image_url: null }).error).toBeUndefined();
  });

  it('rejects an empty name, a bad status, and an empty patch', () => {
    expect(validateAdminProductPatch({ name: '   ' }).error).toContain('must not be empty');
    expect(validateAdminProductPatch({ status: 'live' }).error).toContain('must be one of');
    expect(validateAdminProductPatch({ status: 'published' }).error).toBeUndefined();
    expect(validateAdminProductPatch({}).error).toContain('No editable field');
  });
});

describe('updateAdminProduct', () => {
  it('returns the mapped updated product', async () => {
    const client = fakeClient((table) =>
      table === 'products' ? ok(adminRow({ name: 'Renamed' })) : ok([])
    );
    const result = await updateAdminProduct(client, 'prod-1', { name: 'Renamed' });
    expect(result.product?.name).toBe('Renamed');
    expect(result.error).toBeUndefined();
  });

  it('reports a plain migration-045 error when a status edit hits a missing column', async () => {
    const client = fakeClient(() => err('42703', 'column "status" does not exist'));
    const result = await updateAdminProduct(client, 'prod-1', { status: 'rejected' });
    expect(result.product).toBeNull();
    expect(result.error).toContain('migration 045');
  });

  it('reports not found when the update matches no row', async () => {
    const client = fakeClient(() => ok(null));
    const result = await updateAdminProduct(client, 'prod-missing', { name: 'X' });
    expect(result.product).toBeNull();
    expect(result.error).toBe('Product not found.');
  });
});

describe('deleteAdminProduct', () => {
  it('soft-deletes (ok) when a row matches', async () => {
    const client = fakeClient(() => ok({ id: 'prod-1' }));
    expect(await deleteAdminProduct(client, 'prod-1')).toEqual({ ok: true });
  });

  it('reports not found when no row matches', async () => {
    const client = fakeClient(() => ok(null));
    const result = await deleteAdminProduct(client, 'prod-missing');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Product not found.');
  });
});

// ---------------------------------------------------------------------------
// #70 — review views
// ---------------------------------------------------------------------------

describe('listDuplicateCandidates (deduplication service)', () => {
  it('finds same-GTIN and same name+brand pairs via the pipeline sweep', async () => {
    const rows = [
      { id: 'a', name: 'Widget Pro', slug: 'widget-pro', brand: 'Acme', gtin: '4006381333931' },
      { id: 'b', name: 'Widget Pro 2', slug: 'widget-pro-2', brand: 'Acme', gtin: '4006381333931' },
      { id: 'c', name: 'Gadget', slug: 'gadget', brand: 'Beta', gtin: null },
      { id: 'd', name: 'Gadget', slug: 'gadget-2', brand: 'Beta', gtin: null },
    ];
    const client = fakeClient((table) => (table === 'products' ? ok(rows) : ok([])));
    const result = await listDuplicateCandidates(client, 50);
    // findDuplicateCandidates (services/pipeline/deduplication.ts)
    // is a pure sweep over the product list — the service path runs.
    expect(result.source).toBe('deduplication-service');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.matchedBy).sort()).toEqual(['gtin', 'name-brand']);
    const gtin = result.candidates.find((c) => c.matchedBy === 'gtin');
    expect(gtin?.detail).toContain('4006381333931');
  });

  it('finds fuzzy same-brand renames the exact scan would miss', async () => {
    const rows = [
      { id: 'a', name: 'MacBook Air 13-inch', slug: 'macbook-air-13-inch', brand: 'Apple', gtin: null },
      { id: 'b', name: 'MacBook Air 13', slug: 'macbook-air-13', brand: 'Apple', gtin: null },
    ];
    const client = fakeClient((table) => (table === 'products' ? ok(rows) : ok([])));
    const result = await listDuplicateCandidates(client, 50);
    expect(result.source).toBe('deduplication-service');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.matchedBy).toBe('name-brand-fuzzy');
    expect(result.candidates[0]?.detail).toContain('0.75');
  });

  it('returns an empty list when nothing collides', async () => {
    const rows = [
      { id: 'a', name: 'Widget Pro', slug: 'widget-pro', brand: 'Acme', gtin: null },
      { id: 'b', name: 'Gadget', slug: 'gadget', brand: 'Beta', gtin: null },
    ];
    const client = fakeClient((table) => (table === 'products' ? ok(rows) : ok([])));
    const result = await listDuplicateCandidates(client, 50);
    expect(result.source).toBe('deduplication-service');
    expect(result.candidates).toEqual([]);
  });
});

describe('scanDuplicateCandidates (fallback scan)', () => {
  it('finds same-GTIN and same name+brand pairs on its own', async () => {
    const rows = [
      { id: 'a', name: 'Widget Pro', slug: 'widget-pro', brand: 'Acme', gtin: '4006381333931' },
      { id: 'b', name: 'Widget Pro 2', slug: 'widget-pro-2', brand: 'Acme', gtin: '4006381333931' },
      { id: 'c', name: 'Gadget', slug: 'gadget', brand: 'Beta', gtin: null },
      { id: 'd', name: 'Gadget', slug: 'gadget-2', brand: 'Beta', gtin: null },
    ];
    const client = fakeClient((table) => (table === 'products' ? ok(rows) : ok([])));
    const candidates = await scanDuplicateCandidates(client, 50);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.matchedBy).sort()).toEqual(['gtin', 'name-brand']);
  });
});

describe('listProductsMissingSpecs', () => {
  it('returns products with zero attribute rows', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          { id: 'p1', name: 'A', slug: 'a', brand: 'Acme', category: 'Laptops' },
          { id: 'p2', name: 'B', slug: 'b', brand: 'Beta', category: 'Phones' },
        ]);
      }
      if (table === 'product_attributes') return ok([{ product_id: 'p1' }]);
      return ok([]);
    });
    const result = await listProductsMissingSpecs(client, 50);
    expect(result.checked).toBe(2);
    expect(result.products.map((p) => p.id)).toEqual(['p2']);
  });
});

describe('listProductImageStatus', () => {
  it('classifies ok / missing-image / invalid-image-url', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          { id: 'p1', name: 'A', slug: 'a', image_url: 'https://example.com/a.jpg' },
          { id: 'p2', name: 'B', slug: 'b', image_url: null },
          { id: 'p3', name: 'C', slug: 'c', image_url: 'data:image/png;base64,AAAA' },
        ]);
      }
      if (table === 'product_images') return ok([{ product_id: 'p1' }]);
      return ok([]);
    });
    const result = await listProductImageStatus(client, 50);
    expect(result.rows.map((r) => r.status)).toEqual(['ok', 'missing-image', 'invalid-image-url']);
    expect(result.rows[0]?.imageCount).toBe(1);
  });
});

describe('getAdminProductPriceHistory', () => {
  it('resolves retailer slugs onto history rows, newest first', async () => {
    const client = fakeClient((table) => {
      if (table === 'price_history') {
        return ok([
          { id: 'h1', product_id: 'p1', retailer_id: 'r1', price: 999, currency: 'USD', availability: 'in_stock', recorded_at: '2026-11-12T08:00:00.000Z' },
        ]);
      }
      if (table === 'retailers') return ok([{ id: 'r1', slug: 'amazon' }]);
      return ok([]);
    });
    const result = await getAdminProductPriceHistory(client, 'p1', 20);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.retailerSlug).toBe('amazon');
    expect(result.rows[0]?.price).toBe(999);
  });
});

describe('listProductsPriceHistorySummary', () => {
  it('counts points per product and shows 0 for products with no history', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          { id: 'p1', name: 'A', slug: 'a' },
          { id: 'p2', name: 'B', slug: 'b' },
        ]);
      }
      if (table === 'price_history') {
        return ok([
          { product_id: 'p1', recorded_at: '2026-11-12T08:00:00.000Z' },
          { product_id: 'p1', recorded_at: '2026-11-02T08:00:00.000Z' },
        ]);
      }
      return ok([]);
    });
    const result = await listProductsPriceHistorySummary(client, 50);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((r) => r.productId === 'p1')?.pointCount).toBe(2);
    const p2 = result.rows.find((r) => r.productId === 'p2');
    expect(p2?.pointCount).toBe(0);
    expect(p2?.latestRecordedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #85 — /admin/ai data-quality summary
// ---------------------------------------------------------------------------

describe('getAdminDataQualitySummary', () => {
  it('computes verification, freshness, coverage, and an average score', async () => {
    const client = fakeClient((table) => {
      if (table === 'products') {
        return ok([
          {
            id: 'p1', name: 'A', slug: 'a', brand: 'Apple', category: 'Laptops',
            description: 'Good laptop.', image_url: 'https://example.com/a.jpg',
            gtin: '4006381333931', price_verification_status: 'verified',
            price_verified_at: '2026-11-12T08:00:00.000Z', data_freshness: '2026-11-12T08:00:00.000Z',
          },
          {
            id: 'p2', name: 'B', slug: 'b', brand: null, category: null,
            description: null, image_url: null,
            gtin: null, price_verification_status: 'unverified',
            price_verified_at: null, data_freshness: '2026-11-02T07:13:52.000Z',
          },
        ]);
      }
      if (table === 'product_attributes') return ok([{ product_id: 'p1' }, { product_id: 'p1' }]);
      if (table === 'reviews') return ok([]);
      if (table === 'merchant_products') {
        return ok([
          { product_id: 'p1', price: 999, in_stock: true, price_source: 'ebay-browse-api' },
          { product_id: 'p1', price: 1019, in_stock: true, price_source: 'manual-intake' },
          { product_id: 'p2', price: 99, in_stock: true, price_source: 'manual-intake' },
        ]);
      }
      if (table === 'price_history') {
        return ok([
          { product_id: 'p1', recorded_at: '2026-11-12T08:00:00.000Z' },
          { product_id: 'p2', recorded_at: '2026-11-02T07:13:52.000Z' },
        ]);
      }
      if (table === 'product_images') return ok([{ product_id: 'p1' }]);
      return ok([]);
    });
    const summary = await getAdminDataQualitySummary(client);
    expect(summary.productsTotal).toBe(2);
    expect(summary.verification.verified).toBe(1);
    expect(summary.verification.unverified).toBe(1);
    expect(summary.freshness.fresh).toBe(1);
    expect(summary.freshness.stale).toBe(1);
    expect(summary.productsWithImages).toBe(1);
    expect(summary.productsWithGtin).toBe(1);
    expect(summary.productsWithSpecs).toBe(1);
    expect(summary.productsWithReviews).toBe(0);
    expect(summary.productsWithHistory).toBe(2);
    expect(summary.priceHistoryPoints).toBe(2);
    expect(summary.averageDataQualityScore).not.toBeNull();
    expect(summary.averageDataQualityScore as number).toBeGreaterThan(0);
    expect(summary.averageDataQualityScore as number).toBeLessThanOrEqual(100);
    expect(summary.columnsMissing).toBe(false);
  });

  it('reports columnsMissing and unknown verification when 045 is unapplied', async () => {
    let calls = 0;
    const client = fakeClient((table) => {
      if (table === 'products') {
        calls += 1;
        if (calls === 1) return err('42703', 'column "price_verification_status" does not exist');
        return ok([
          {
            id: 'p1', name: 'A', slug: 'a', brand: 'Apple', category: 'Laptops',
            description: 'Good laptop.', image_url: null, gtin: null,
            data_freshness: '2026-11-12T08:00:00.000Z',
          },
        ]);
      }
      return ok([]);
    });
    const summary = await getAdminDataQualitySummary(client);
    expect(summary.columnsMissing).toBe(true);
    expect(summary.verification.unknown).toBe(1);
    expect(summary.productsTotal).toBe(1);
    expect(summary.notes.length).toBeGreaterThan(0);
  });
});
