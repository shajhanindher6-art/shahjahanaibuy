/**
 * Section 20 — GTIN / image / per-product quality-score / freshness
 * tests (audit §12 #104-105 follow-ons, §10 "GTIN / image /
 * data-quality scoring — NONE (direct)").
 *
 * Covers, with no network and no DB:
 * - validateGtin / normalizeGtin / isValidGtin (lib/gtin.ts, §12 #31)
 *   — GS1 check digits for GTIN-8/12/13/14, space/hyphen
 *   normalization, invalid inputs rejected with reasons.
 * - validateImageUrl (lib/image-url.ts, §12 #94) — http(s) only;
 *   data: / javascript: / credentials / bare host / over-long
 *   URLs rejected (2048-char cap).
 * - computeProductQualityScore (services/product-quality-score.ts)
 *   — every dimension (identity, specs, images, price freshness,
 *   merchant reliability, GTIN validity, attribution), the
 *   breakdown shape, and NO 50-floor.
 * - GTIN + image URL through the intake path: validateRawProduct
 *   now enforces both (lib/gtin.ts + lib/image-url.ts wired into
 *   the zod schema, §12 #31/#94).
 * - Price-freshness gate helpers (lib/price-freshness.ts):
 *   STALE_PRICE_DAYS = 7, isPriceStale boundary, three-state
 *   getFreshnessStatus. NOTE: the alert-checker wiring itself
 *   (audit P0-3) is NOT here — services/alert-checker.ts has no
 *   freshness gate yet; that is the P0 worker's item.
 * - refreshTrackedPrices currency + freshness-stamp behaviour
 *   (services/price-refresh.ts) against a mocked client — both
 *   Section 20 fixes LANDED (§12 #41 currency, §12 #43 re-read
 *   stamp) and are asserted as fixed behaviour here.
 *
 * Adaptations (interfaces differed from the task brief):
 * - Platform-status relabel (recorded-prices-only / tag-only) is
 *   already covered by the P0 worker in tests/platform-status.test.ts
 *   — not duplicated here.
 */
import { describe, expect, it } from 'vitest';
import {
  computeProductQualityScore,
  dataQualityGrade,
  DATA_QUALITY_SCORE_LABEL,
} from '@/services/product-quality-score';
import {
  validateGtin,
  normalizeGtin,
  isValidGtin,
  GTIN_LENGTHS,
} from '@/lib/gtin';
import { validateImageUrl, isValidImageUrl, IMAGE_URL_MAX_LENGTH } from '@/lib/image-url';
import {
  STALE_PRICE_DAYS,
  isPriceStale,
  getFreshnessStatus,
  formatVerdictFreshnessNote,
} from '@/lib/price-freshness';
import { validateRawProduct } from '@/services/pipeline/validation';
import { refreshTrackedPrices } from '@/services/price-refresh';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// validateGtin / normalizeGtin / isValidGtin (lib/gtin.ts, §12 #31)
// ---------------------------------------------------------------------------

describe('validateGtin', () => {
  it('accepts valid GTIN-8 / GTIN-12 / GTIN-13 / GTIN-14 check digits', () => {
    expect(validateGtin('96385074')).toEqual({
      valid: true,
      normalized: '96385074',
      reason: null,
    }); // GTIN-8
    expect(validateGtin('036000291452').valid).toBe(true); // GTIN-12 (UPC)
    expect(validateGtin('5901234123457').valid).toBe(true); // GTIN-13 (EAN)
    expect(validateGtin('9780201379624').valid).toBe(true); // GTIN-13 (ISBN)
    expect(validateGtin('12345678901231').valid).toBe(true); // GTIN-14
  });

  it('normalizes spaces and hyphens before the check', () => {
    expect(validateGtin('5901 2341 2345 7')).toEqual({
      valid: true,
      normalized: '5901234123457',
      reason: null,
    });
    expect(validateGtin('978-0-201-37962-4').normalized).toBe('9780201379624');
    expect(validateGtin(' 036000291452 ').valid).toBe(true);
  });

  it('rejects a wrong check digit with the expected digit in the reason', () => {
    const out = validateGtin('5901234123458');
    expect(out.valid).toBe(false);
    expect(out.normalized).toBeNull();
    expect(out.reason).toContain('expected 7, got 8');
    expect(validateGtin('036000291453').valid).toBe(false);
    expect(validateGtin('96385075').valid).toBe(false);
    expect(validateGtin('12345678901232').valid).toBe(false);
  });

  it('rejects wrong lengths with the length in the reason', () => {
    for (const bad of ['1234567', '123456789', '12345678901', '123456789012345']) {
      const out = validateGtin(bad);
      expect(out.valid).toBe(false);
      expect(out.reason).toContain('8, 12, 13 or 14 digits');
    }
    expect(GTIN_LENGTHS).toEqual([8, 12, 13, 14]);
  });

  it('rejects letters, empty, null, and undefined', () => {
    expect(validateGtin('590123412345A').valid).toBe(false);
    expect(validateGtin('ABC').reason).toContain('digits only');
    expect(validateGtin('').reason).toBe('GTIN is empty');
    expect(validateGtin(null).valid).toBe(false);
    expect(validateGtin(undefined).valid).toBe(false);
  });
});

describe('normalizeGtin', () => {
  it('strips spaces and hyphens, keeps digits', () => {
    expect(normalizeGtin('978-0-201-37962-4')).toBe('9780201379624');
    expect(normalizeGtin('5901 2341 2345 7')).toBe('5901234123457');
    expect(normalizeGtin('5901234123457')).toBe('5901234123457');
  });

  it('maps absent / blank to null, never to an empty string', () => {
    expect(normalizeGtin(null)).toBeNull();
    expect(normalizeGtin(undefined)).toBeNull();
    expect(normalizeGtin('')).toBeNull();
    expect(normalizeGtin('  --  ')).toBeNull();
  });
});

describe('isValidGtin (boolean wrapper)', () => {
  it('agrees with validateGtin().valid', () => {
    for (const v of ['5901234123457', '5901234123458', '978-0-201-37962-4', null, '']) {
      expect(isValidGtin(v)).toBe(validateGtin(v).valid);
    }
  });
});

// ---------------------------------------------------------------------------
// validateImageUrl / isValidImageUrl (lib/image-url.ts, §12 #94)
// ---------------------------------------------------------------------------

describe('validateImageUrl', () => {
  it('accepts http and https URLs and returns the trimmed URL', () => {
    expect(validateImageUrl('https://example.com/a.jpg')).toEqual({
      valid: true,
      normalized: 'https://example.com/a.jpg',
      reason: null,
    });
    expect(validateImageUrl('http://example.com/a.jpg').valid).toBe(true);
    expect(validateImageUrl('HTTPS://example.com/a.jpg').valid).toBe(true);
    expect(validateImageUrl('  https://example.com/a.jpg  ').normalized).toBe(
      'https://example.com/a.jpg'
    );
  });

  it('rejects data: / javascript: / blob: / ftp: URLs', () => {
    for (const bad of [
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      'blob:https://example.com/123',
      'ftp://example.com/a.jpg',
    ]) {
      const out = validateImageUrl(bad);
      expect(out.valid).toBe(false);
      expect(out.normalized).toBeNull();
      expect(out.reason).toContain('http(s)');
    }
  });

  it('rejects relative paths, bare hostnames, and blanks', () => {
    expect(validateImageUrl('/images/a.jpg').valid).toBe(false);
    expect(validateImageUrl('//example.com/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://localhost/a.jpg').valid).toBe(false);
    expect(validateImageUrl('https://intranet/a.jpg').valid).toBe(false);
    expect(validateImageUrl('not a url').valid).toBe(false);
    expect(validateImageUrl('').reason).toBe('Image URL is empty');
    expect(validateImageUrl(null).valid).toBe(false);
    expect(validateImageUrl(123).valid).toBe(false);
  });

  it('rejects embedded credentials', () => {
    const out = validateImageUrl('https://user:pass@example.com/a.jpg');
    expect(out.valid).toBe(false);
    expect(out.reason).toContain('credentials');
  });

  it('rejects whitespace / control characters inside the URL', () => {
    expect(validateImageUrl('https://example.com/a b.jpg').valid).toBe(false);
    expect(validateImageUrl('https://example.com/a\tb.jpg').valid).toBe(false);
  });

  it('rejects URLs over the 2048-char cap (IMAGE_URL_MAX_LENGTH)', () => {
    expect(IMAGE_URL_MAX_LENGTH).toBe(2048);
    const long = 'https://example.com/' + 'a'.repeat(2048);
    const out = validateImageUrl(long);
    expect(out.valid).toBe(false);
    expect(out.reason).toContain('2048');
    expect(validateImageUrl('https://example.com/' + 'a'.repeat(2020)).valid).toBe(true);
  });

  it('isValidImageUrl agrees with validateImageUrl().valid', () => {
    expect(isValidImageUrl('https://example.com/a.jpg')).toBe(true);
    expect(isValidImageUrl('data:image/png;base64,xx')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeProductQualityScore
// ---------------------------------------------------------------------------

describe('computeProductQualityScore', () => {
  const NOW = new Date('2026-11-13T12:00:00.000Z');
  const FRESH = '2026-11-13T08:00:00.000Z'; // 0 days old at NOW
  const STALE_11D = '2026-11-02T07:13:52.000Z'; // 11 days old at NOW

  const FULL_PRODUCT = {
    name: 'Sony WH-1000XM5',
    slug: 'sony-wh-1000xm5',
    brand: 'Sony',
    category: 'Electronics > Headphones',
    description: 'Noise cancelling headphones',
    imageUrl: 'https://example.com/a.jpg',
    gtin: '5901234123457',
    priceVerificationStatus: 'verified' as const,
    priceVerifiedAt: FRESH,
    dataFreshness: FRESH,
  };
  const FULL_CONTEXT = {
    specCount: 6,
    imageCount: 2,
    merchantCount: 2,
    inStockMerchantCount: 2,
    priceSource: 'merchant-feed',
    lastPriceRecordedAt: FRESH,
  };

  it('scores a complete, fresh, verified record 100 with grade good', () => {
    const out = computeProductQualityScore(FULL_PRODUCT, FULL_CONTEXT, NOW);
    expect(out.score).toBe(100);
    expect(out.grade).toBe('good');
    expect(out.missingFields).toEqual([]);
    expect(out.priceVerificationStatus).toBe('verified');
    expect(out.priceAgeDays).toBe(0);
    expect(out.dimensions.map((d) => d.key)).toEqual([
      'identity',
      'specs',
      'images',
      'priceFreshness',
      'merchants',
      'gtin',
      'attribution',
    ]);
  });

  it('dimension weights sum to 100 and points sum to the total', () => {
    const out = computeProductQualityScore(FULL_PRODUCT, FULL_CONTEXT, NOW);
    expect(out.dimensions.reduce((s, d) => s + d.weight, 0)).toBe(100);
    expect(out.dimensions.reduce((s, d) => s + d.points, 0)).toBe(out.score);
    for (const d of out.dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
      expect(d.points).toBeLessThanOrEqual(d.weight);
    }
  });

  it('has NO floor: a name-only record scores 5, grade poor', () => {
    const out = computeProductQualityScore({ name: 'Widget' }, {}, NOW);
    expect(out.score).toBe(5); // identity 5/15 only; everything else 0
    expect(out.grade).toBe('poor');
    expect(out.missingFields).toContain('GTIN');
    expect(out.missingFields).toContain('specs');
    expect(out.missingFields).toContain('recent price check');
    expect(out.priceAgeDays).toBeNull();
  });

  it('identity dimension scores name 5 / brand 4 / category 3 / description 3', () => {
    const out = computeProductQualityScore(
      { name: 'Widget', brand: 'Acme' },
      {},
      NOW
    );
    const identity = out.dimensions.find((d) => d.key === 'identity')!;
    expect(identity.score).toBe(60); // (5+4)/15
    expect(identity.points).toBe(9);
    expect(identity.missingFields).toEqual(['category', 'description']);
  });

  it('spec bands: 0 → 0, 1–2 → 40, 3–5 → 70, 6+ → 100', () => {
    const scoreFor = (specCount: number) =>
      computeProductQualityScore(FULL_PRODUCT, { ...FULL_CONTEXT, specCount }, NOW).dimensions.find(
        (d) => d.key === 'specs'
      )!.score;
    expect(scoreFor(0)).toBe(0);
    expect(scoreFor(1)).toBe(40);
    expect(scoreFor(2)).toBe(40);
    expect(scoreFor(3)).toBe(70);
    expect(scoreFor(5)).toBe(70);
    expect(scoreFor(6)).toBe(100);
  });

  it('images: valid URL alone 67, gallery rows alone 33, both 100', () => {
    const scoreFor = (imageUrl: string | null, imageCount: number | null) =>
      computeProductQualityScore(
        { ...FULL_PRODUCT, imageUrl },
        { ...FULL_CONTEXT, imageCount },
        NOW
      ).dimensions.find((d) => d.key === 'images')!.score;
    expect(scoreFor('https://example.com/a.jpg', 0)).toBe(67);
    expect(scoreFor(null, 3)).toBe(33);
    expect(scoreFor('https://example.com/a.jpg', 2)).toBe(100);
    expect(scoreFor('data:image/png;base64,xx', 2)).toBe(33);
  });

  it('price freshness: fresh 100, 11 days (stale) 50, >30 days 20, unknown 0', () => {
    const scoreFor = (lastPriceRecordedAt: string | null) =>
      computeProductQualityScore(
        FULL_PRODUCT,
        { ...FULL_CONTEXT, lastPriceRecordedAt },
        NOW
      ).dimensions.find((d) => d.key === 'priceFreshness')!;
    expect(scoreFor(FRESH).score).toBe(100);
    const stale11 = scoreFor(STALE_11D);
    expect(stale11.score).toBe(50);
    expect(stale11.missingFields).toContain('recent price check');
    expect(scoreFor('2026-09-01T00:00:00.000Z').score).toBe(20);
    // "Unknown" needs NO fallback either: lastPriceRecordedAt null
    // coalesces to priceVerifiedAt / dataFreshness, so clear those.
    const unknown = computeProductQualityScore(
      { ...FULL_PRODUCT, priceVerifiedAt: null, dataFreshness: null },
      { ...FULL_CONTEXT, lastPriceRecordedAt: null },
      NOW
    ).dimensions.find((d) => d.key === 'priceFreshness')!;
    expect(unknown.score).toBe(0);
  });

  it('priceAgeDays prefers history, then verified_at, then data_freshness', () => {
    const out = computeProductQualityScore(
      { ...FULL_PRODUCT, priceVerifiedAt: null, dataFreshness: STALE_11D },
      { ...FULL_CONTEXT, lastPriceRecordedAt: null },
      NOW
    );
    expect(out.priceAgeDays).toBe(11);
  });

  it('merchant reliability: 2+ in stock 100, 1 in stock 60, none in stock 30, none 0', () => {
    const scoreFor = (merchantCount: number | null, inStockMerchantCount: number | null) =>
      computeProductQualityScore(
        FULL_PRODUCT,
        { ...FULL_CONTEXT, merchantCount, inStockMerchantCount },
        NOW
      ).dimensions.find((d) => d.key === 'merchants')!.score;
    expect(scoreFor(2, 2)).toBe(100);
    expect(scoreFor(1, 1)).toBe(60);
    expect(scoreFor(2, 0)).toBe(30);
    expect(scoreFor(0, 0)).toBe(0);
    expect(scoreFor(null, null)).toBe(0);
  });

  it('GTIN: valid 100, invalid check digit 0, missing 0', () => {
    const scoreFor = (gtin: string | null) =>
      computeProductQualityScore({ ...FULL_PRODUCT, gtin }, FULL_CONTEXT, NOW).dimensions.find(
        (d) => d.key === 'gtin'
      )!;
    expect(scoreFor('5901234123457').score).toBe(100);
    expect(scoreFor('5901234123458').score).toBe(0);
    expect(scoreFor('5901234123458').missingFields).toEqual(['valid GTIN']);
    expect(scoreFor(null).score).toBe(0);
    expect(scoreFor(null).missingFields).toEqual(['GTIN']);
  });

  it('attribution: source + verified date 100, one of them 50, neither 0', () => {
    const scoreFor = (priceSource: string | null, priceVerifiedAt: string | null) =>
      computeProductQualityScore(
        { ...FULL_PRODUCT, priceVerifiedAt },
        { ...FULL_CONTEXT, priceSource },
        NOW
      ).dimensions.find((d) => d.key === 'attribution')!.score;
    expect(scoreFor('merchant-feed', FRESH)).toBe(100);
    expect(scoreFor('merchant-feed', null)).toBe(50);
    expect(scoreFor(null, FRESH)).toBe(50);
    expect(scoreFor(null, null)).toBe(0);
  });

  it('normalizes unknown verification status to unverified', () => {
    const out = computeProductQualityScore(
      { ...FULL_PRODUCT, priceVerificationStatus: 'bogus' },
      FULL_CONTEXT,
      NOW
    );
    expect(out.priceVerificationStatus).toBe('unverified');
  });

  it('label is "Data quality score", never a product-quality claim', () => {
    expect(DATA_QUALITY_SCORE_LABEL).toBe('Data quality score');
  });

  it('dataQualityGrade boundaries: 80 good, 50 fair, 49 poor', () => {
    expect(dataQualityGrade(100)).toBe('good');
    expect(dataQualityGrade(80)).toBe('good');
    expect(dataQualityGrade(79)).toBe('fair');
    expect(dataQualityGrade(50)).toBe('fair');
    expect(dataQualityGrade(49)).toBe('poor');
    expect(dataQualityGrade(0)).toBe('poor');
  });
});

// ---------------------------------------------------------------------------
// GTIN through the intake path (no dedicated validator in intake)
// ---------------------------------------------------------------------------

describe('GTIN through intake validation', () => {
  const base = {
    externalId: 'ext-1',
    retailerSlug: 'amazon',
    name: 'Widget',
    price: 10,
    currency: 'USD',
    availability: 'in_stock' as const,
  };

  it('intake rejects a GTIN over 50 chars and a bad check digit (§12 #31)', () => {
    expect(validateRawProduct({ ...base, gtin: '1'.repeat(51) }).success).toBe(false);
    expect(validateRawProduct({ ...base, gtin: '5901234123457' }).success).toBe(true);
    // A bad check digit is now rejected at intake (GS1 validation
    // wired into the schema) — it no longer reaches the scorer.
    const bad = validateRawProduct({ ...base, gtin: '5901234123458' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.errors.gtin?.[0]).toContain('check digit');
    expect(validateRawProduct({ ...base, gtin: 'NOT-A-GTIN' }).success).toBe(false);
    // Separators normalize before the check: hyphenated valid GTIN passes.
    expect(validateRawProduct({ ...base, gtin: '978-0-201-37962-4' }).success).toBe(true);
  });

  it('intake rejects a data: image URL (§12 #94)', () => {
    const bad = validateRawProduct({
      ...base,
      images: ['data:image/png;base64,iVBORw0KGgo='],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.errors.images).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Price-freshness gate helpers (the alert gate's basis)
// ---------------------------------------------------------------------------

describe('stale-price gate helpers', () => {
  const NOW = new Date('2026-11-13T12:00:00.000Z');

  it('STALE_PRICE_DAYS is 7', () => {
    expect(STALE_PRICE_DAYS).toBe(7);
  });

  it('isPriceStale: 7 days is not stale, 8 days is', () => {
    expect(isPriceStale('2026-11-06T12:00:00.000Z', NOW)).toBe(false); // exactly 7d
    // 7 days + 1 second still floors to 7 whole days → not stale.
    expect(isPriceStale('2026-11-06T11:59:59.000Z', NOW)).toBe(false);
    expect(isPriceStale('2026-11-05T12:00:00.000Z', NOW)).toBe(true); // 8d
  });

  it('isPriceStale: unknown age is NOT stale (never read as fresh either)', () => {
    expect(isPriceStale(null, NOW)).toBe(false);
    expect(isPriceStale(undefined, NOW)).toBe(false);
    expect(isPriceStale('', NOW)).toBe(false);
    expect(isPriceStale('not-a-date', NOW)).toBe(false);
  });

  it('isPriceStale: a future check date is not stale', () => {
    expect(isPriceStale('2026-11-14T12:00:00.000Z', NOW)).toBe(false);
  });

  it('getFreshnessStatus distinguishes fresh / stale / unknown', () => {
    expect(getFreshnessStatus('2026-11-13T08:00:00.000Z', NOW)).toEqual({
      status: 'fresh',
      ageDays: 0,
    });
    expect(getFreshnessStatus('2026-11-02T07:13:52.000Z', NOW)).toEqual({
      status: 'stale',
      ageDays: 11,
    });
    expect(getFreshnessStatus(null, NOW)).toEqual({ status: 'unknown', ageDays: null });
    expect(getFreshnessStatus('garbage', NOW)).toEqual({ status: 'unknown', ageDays: null });
  });

  it('formatVerdictFreshnessNote: fresh → null, stale → day count, unknown → warning', () => {
    expect(formatVerdictFreshnessNote('2026-11-13T08:00:00.000Z', NOW)).toBeNull();
    expect(formatVerdictFreshnessNote('2026-11-02T07:13:52.000Z', NOW)).toContain('11 days ago');
    expect(formatVerdictFreshnessNote(null, NOW)).toContain('Price age unknown');
  });
});

// ---------------------------------------------------------------------------
// refreshTrackedPrices — currency + freshness-stamp behaviour
// (mocked Supabase; no DB, no network)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface RefreshFakeOptions {
  alertIds?: string[];
  wishlistIds?: string[];
  merchantRows?: Row[];
  merchants?: Row[];
  retailers?: Row[];
  historyRows?: Row[];
  currencies?: Row[];
  alertsError?: { message: string } | null;
}

function refreshFakeClient(opts: RefreshFakeOptions) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const updates: Array<{ table: string; patch: Row }> = [];
  const deletes: string[] = [];

  function chain(table: string) {
    let rows: Row[] = [];
    if (table === 'alerts') rows = (opts.alertIds ?? []).map((id) => ({ product_id: id, active: true }));
    if (table === 'wishlist_items')
      rows = (opts.wishlistIds ?? []).map((id) => ({ product_id: id }));
    if (table === 'merchant_products') rows = [...(opts.merchantRows ?? [])];
    if (table === 'merchants') rows = [...(opts.merchants ?? [])];
    if (table === 'retailers') rows = [...(opts.retailers ?? [])];
    if (table === 'price_history') rows = [...(opts.historyRows ?? [])];
    if (table === 'currencies') rows = [...(opts.currencies ?? [])];

    const q: Record<string, unknown> = {
      select() {
        return q;
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] === value);
        return q;
      },
      is(column: string, value: unknown) {
        rows = rows.filter((r) => (value === null ? r[column] == null : r[column] === value));
        return q;
      },
      in(column: string, value: unknown) {
        rows = rows.filter((r) => (value as unknown[]).includes(r[column]));
        return q;
      },
      lt() {
        return q;
      },
      gt() {
        return q;
      },
      gte() {
        return q;
      },
      lte() {
        return q;
      },
      order(_column: string, _opts?: { ascending?: boolean }) {
        return q;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return q;
      },
      insert(row: Row) {
        inserts.push({ table, row });
        return q;
      },
      update(patch: Row) {
        updates.push({ table, patch });
        return q;
      },
      delete() {
        deletes.push(table);
        return q;
      },
      then(onF: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) {
        if (table === 'alerts' && opts.alertsError) {
          return Promise.resolve({ data: null, error: opts.alertsError }).then(onF);
        }
        return Promise.resolve({ data: rows, error: null }).then(onF);
      },
    };
    return q;
  }

  const client = {
    from: (table: string) => chain(table),
    inserts,
    updates,
    deletes,
  };
  return client as unknown as AnySupabaseClient & {
    inserts: typeof inserts;
    updates: typeof updates;
    deletes: typeof deletes;
  };
}

const MERCHANT_ROW = {
  product_id: 'prod-1',
  merchant_id: 'merch-amazon',
  price: 299,
  availability: 'in_stock',
  url: 'https://example.com/sony',
  in_stock: true,
  deleted_at: null,
  currency_id: null,
};

function refreshFixture(overrides: RefreshFakeOptions = {}) {
  return refreshFakeClient({
    alertIds: ['prod-1'],
    merchantRows: [MERCHANT_ROW],
    merchants: [{ id: 'merch-amazon', slug: 'amazon' }],
    retailers: [{ id: 'retailer-1', slug: 'amazon' }],
    historyRows: [],
    ...overrides,
  });
}

describe('refreshTrackedPrices — currency and freshness-stamp behaviour', () => {
  it('inserts a price_history row on a price change, in the listing currency (§12 #41)', async () => {
    const client = refreshFixture({
      merchantRows: [{ ...MERCHANT_ROW, currency_id: 'cur-eur' }],
      currencies: [{ id: 'cur-eur', code: 'EUR' }],
      historyRows: [
        { product_id: 'prod-1', retailer_id: 'retailer-1', price: 279, availability: 'in_stock', recorded_at: '2026-11-02T07:13:52.000Z' },
      ],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.inserted).toBe(1);
    expect(result.tracked).toBe(1);
    const historyInsert = client.inserts.find((i) => i.table === 'price_history');
    expect(historyInsert).toBeDefined();
    expect(historyInsert!.row.product_id).toBe('prod-1');
    expect(historyInsert!.row.price).toBe(299);
    // The row's own currency, resolved from its currency_id — a
    // non-USD listing is never silently recorded as USD.
    expect(historyInsert!.row.currency).toBe('EUR');
  });

  it('defaults the insert currency to USD when the listing has no currency_id', async () => {
    const client = refreshFixture({
      historyRows: [
        { product_id: 'prod-1', retailer_id: 'retailer-1', price: 279, availability: 'in_stock', recorded_at: '2026-11-02T07:13:52.000Z' },
      ],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.inserted).toBe(1);
    const historyInsert = client.inserts.find((i) => i.table === 'price_history');
    expect(historyInsert!.row.currency).toBe('USD');
  });

  it('does NOT insert on an unchanged price', async () => {
    const client = refreshFixture({
      historyRows: [
        { product_id: 'prod-1', retailer_id: 'retailer-1', price: 299, availability: 'in_stock', recorded_at: '2026-11-02T07:13:52.000Z' },
      ],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.unchanged).toBe(1);
    expect(result.inserted).toBe(0);
    expect(client.inserts.filter((i) => i.table === 'price_history')).toHaveLength(0);
  });

  it('an unchanged re-read does NOT move data_freshness (§12 #43)', async () => {
    const client = refreshFixture({
      historyRows: [
        { product_id: 'prod-1', retailer_id: 'retailer-1', price: 299, availability: 'in_stock', recorded_at: '2026-11-02T07:13:52.000Z' },
      ],
    });
    const result = await refreshTrackedPrices(client);
    expect(result.unchanged).toBe(1);
    // markProductRechecked clears a failed status and nothing else:
    // data_freshness / next_refresh_at deliberately do NOT move —
    // a DB re-read is not a live check.
    expect(
      client.updates.some(
        (u) =>
          u.table === 'products' &&
          (u.patch.data_freshness !== undefined || u.patch.next_refresh_at !== undefined)
      )
    ).toBe(false);
    const recheck = client.updates.find(
      (u) => u.table === 'products' && u.patch.refresh_status === 'idle'
    );
    expect(recheck).toBeDefined();
    expect(recheck!.patch.data_freshness).toBeUndefined();
    expect(recheck!.patch.next_refresh_at).toBeUndefined();
  });

  it('skips a product with no merchant row (skippedNoPrice)', async () => {
    const client = refreshFixture({ merchantRows: [] });
    const result = await refreshTrackedPrices(client);
    expect(result.skippedNoPrice).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('skips a product whose merchant has no retailer slug (skippedNoRetailer)', async () => {
    const client = refreshFixture({ retailers: [] });
    const result = await refreshTrackedPrices(client);
    expect(result.skippedNoRetailer).toBe(1);
    expect(result.inserted).toBe(0);
  });

  it('reports loadFailed when the alerts read errors (never a silent tracked: 0)', async () => {
    const client = refreshFixture({ alertsError: { message: 'boom' } });
    const result = await refreshTrackedPrices(client);
    expect(result.loadFailed).toBe(true);
    expect(result.loadError).toContain('alerts: boom');
  });

  it('returns tracked 0 with no alerts and no wishlist', async () => {
    const client = refreshFixture({ alertIds: [], wishlistIds: [] });
    const result = await refreshTrackedPrices(client);
    expect(result.tracked).toBe(0);
    expect(result.inserted).toBe(0);
    expect(result.loadFailed).toBe(false);
  });
});
