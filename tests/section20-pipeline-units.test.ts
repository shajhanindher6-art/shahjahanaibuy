/**
 * Section 20 — direct unit tests for the data-pipeline units
 * (audit §12 #104, §10 "pipeline units — PARTIAL").
 *
 * Covers, against a mocked Supabase client (no DB, no network):
 * - validateRawProduct (services/pipeline/validation.ts)
 * - normalizeProduct (services/pipeline/normalization.ts)
 * - findDuplicate (services/pipeline/deduplication.ts)
 * - processImages (services/pipeline/image-processing.ts)
 * - assignCategory (services/pipeline/category-assignment.ts)
 * - detectBrand (services/pipeline/brand-detection.ts)
 * - ingestProduct / ingestBatch failure paths
 *   (services/pipeline/ingestion.ts)
 *
 * Known gaps these tests deliberately do NOT cover (they belong to
 * other Section 20 workers / owner-gated code):
 * - GTIN check-digit validation: lib/gtin.ts now exists (Section 20,
 *   §12 #31) and validateRawProduct rejects a bad check digit — the
 *   fixture GTIN below is check-digit-valid, and the old "50-char
 *   GTIN accepted" assertion was updated to expect rejection.
 * - Minimum-confidence gate: a score-15 product is rejected on
 *   BOTH paths now — Sections 21–25, Stage C (B9) extended the
 *   Section 20 create-path gate (§12 #16) to updates, so a thin
 *   feed row can no longer overwrite a catalogued product's
 *   confidence with a 15. The update test below uses a
 *   gate-passing score-30 row to prove the stored score is still
 *   raw (no 50-floor), and a second test pins the thin-row
 *   rejection.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { validateRawProduct } from '@/services/pipeline/validation';
import { normalizeProduct } from '@/services/pipeline/normalization';
import { findDuplicate, normalizeDedupeText, nameTokenSimilarity, NAME_BRAND_FUZZY_THRESHOLD } from '@/services/pipeline/deduplication';
import { processImages, processImagesDetailed } from '@/services/pipeline/image-processing';
import { assignCategory } from '@/services/pipeline/category-assignment';
import { detectBrand } from '@/services/pipeline/brand-detection';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_RAW = {
  externalId: 'ext-sony-1',
  retailerSlug: 'amazon',
  name: 'Sony WH-1000XM5',
  description: 'Noise cancelling headphones',
  brand: 'Sony',
  category: 'Electronics > Headphones',
  // Section 20, §12 #31 — check-digit-valid GS1 GTIN (the old
  // fixture '027242920918' failed the GS1 check digit and would
  // now be rejected by validateRawProduct).
  gtin: '027242920910',
  images: ['https://images.unsplash.com/photo-1505740420928-5e560c06d30e'],
  price: 299,
  currency: 'USD',
  availability: 'in_stock' as const,
  url: 'https://www.amazon.com/dp/B09XS7JWHH',
};

function validRaw(overrides: Record<string, unknown> = {}) {
  return { ...VALID_RAW, ...overrides };
}

// ---------------------------------------------------------------------------
// validateRawProduct
// ---------------------------------------------------------------------------

describe('validateRawProduct', () => {
  it('accepts a complete valid product', () => {
    const result = validateRawProduct(validRaw());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Sony WH-1000XM5');
      expect(result.data.currency).toBe('USD');
    }
  });

  it('accepts a minimal product (only required fields)', () => {
    const result = validateRawProduct({
      externalId: 'ext-1',
      retailerSlug: 'amazon',
      name: 'Widget',
      price: 0,
      currency: 'EUR',
      availability: 'unknown',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing externalId', () => {
    const { externalId, ...rest } = validRaw();
    void externalId;
    const result = validateRawProduct(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.externalId).toBeDefined();
  });

  it('rejects a missing retailerSlug', () => {
    const { retailerSlug, ...rest } = validRaw();
    void retailerSlug;
    const result = validateRawProduct(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.retailerSlug).toBeDefined();
  });

  it('rejects an empty name', () => {
    const result = validateRawProduct(validRaw({ name: '' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.name).toBeDefined();
  });

  it('rejects a negative price', () => {
    const result = validateRawProduct(validRaw({ price: -1 }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.price).toBeDefined();
  });

  it('rejects a non-3-letter currency code', () => {
    for (const currency of ['US', 'USDD', 'usd1']) {
      const result = validateRawProduct(validRaw({ currency }));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errors.currency).toBeDefined();
    }
  });

  it('rejects an unknown availability value', () => {
    const result = validateRawProduct(validRaw({ availability: 'in-store-only' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.availability).toBeDefined();
  });

  it('rejects a non-URL image entry', () => {
    const result = validateRawProduct(validRaw({ images: ['not-a-url'] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors['images.0']).toBeDefined();
  });

  it('rejects a GTIN longer than 50 chars (the only GTIN check today)', () => {
    const result = validateRawProduct(validRaw({ gtin: '1'.repeat(51) }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.gtin).toBeDefined();
  });

  it('rejects a GTIN of exactly 50 chars (not a GS1 length — §12 #31)', () => {
    const result = validateRawProduct(validRaw({ gtin: '1'.repeat(50) }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.gtin).toBeDefined();
  });

  it('rejects a non-object / null input', () => {
    expect(validateRawProduct(null).success).toBe(false);
    expect(validateRawProduct('nope').success).toBe(false);
    expect(validateRawProduct([]).success).toBe(false);
  });

  it('rejects more than 20 images', () => {
    const images = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}.jpg`);
    const result = validateRawProduct(validRaw({ images }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeProduct
// ---------------------------------------------------------------------------

describe('normalizeProduct', () => {
  function normalized(overrides: Record<string, unknown> = {}) {
    const result = validateRawProduct(validRaw(overrides));
    if (!result.success) throw new Error('fixture failed validation');
    return normalizeProduct(result.data);
  }

  it('generates a slug from the name', () => {
    expect(normalized().slug).toBe('sony-wh-1000xm5');
    expect(normalized({ name: 'Apple AirPods Pro (2nd Generation)!' }).slug).toBe(
      'apple-airpods-pro-2nd-generation'
    );
  });

  it('normalizes a category path (trims parts, keeps hierarchy)', () => {
    expect(normalized().category).toBe('Electronics > Headphones');
    expect(normalized({ category: '  Electronics  >   Headphones  ' }).category).toBe(
      'Electronics > Headphones'
    );
  });

  it('upper-cases the currency', () => {
    const result = validateRawProduct(validRaw({ currency: 'eur' }));
    // zod length(3) accepts lowercase; normalize upper-cases it.
    expect(result.success).toBe(true);
    if (result.success) expect(normalizeProduct(result.data).currency).toBe('EUR');
  });

  it('uses the first image as imageUrl and keeps the full list', () => {
    const out = normalized({
      images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    });
    expect(out.imageUrl).toBe('https://example.com/a.jpg');
    expect(out.images).toHaveLength(2);
  });

  it('confidence is a presence count: a complete product scores 100', () => {
    expect(normalized().confidenceScore).toBe(100);
  });

  it('confidence has NO 50-floor at normalize time: name-only scores 15', () => {
    // Audit P0-5: the 50-floor lives only in the ingestion UPDATE
    // path (Math.max(score, 50)); normalize itself is unfloored.
    const result = validateRawProduct({
      externalId: 'ext-1',
      retailerSlug: 'amazon',
      name: 'Widget',
      price: 0,
      currency: 'USD',
      availability: 'unknown',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(normalizeProduct(result.data).confidenceScore).toBe(15);
  });

  it('confidence counts GTIN 20, description 15, images 10, price 10', () => {
    // name 15 + brand 10 + category 10 + gtin 20 + price 10 + url 5
    // + availability 5 = 75 (no description, no images).
    const out = normalized({ description: undefined, images: undefined });
    expect(out.confidenceScore).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Minimal chainable fake Supabase client (arg-injected units only)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>, singleRows: Record<string, Row | null> = {}) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const updates: Array<{ table: string; patch: Row }> = [];
  const upserts: Array<{ table: string; row: Row }> = [];

  function chain(table: string) {
    let rows = [...(tables[table] ?? [])];
    let inserted = false;
    const q: Record<string, unknown> = {
      select() {
        return q;
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] === value);
        return q;
      },
      neq(column: string, value: unknown) {
        rows = rows.filter((r) => r[column] !== value);
        return q;
      },
      is(column: string, value: unknown) {
        rows = rows.filter((r) => (value === null ? r[column] == null : r[column] === value));
        return q;
      },
      ilike(column: string, value: unknown) {
        const needle = String(value).replace(/%/g, '').toLowerCase();
        rows = rows.filter((r) => String(r[column] ?? '').toLowerCase().includes(needle));
        return q;
      },
      in(column: string, value: unknown) {
        rows = rows.filter((r) => (value as unknown[]).includes(r[column]));
        return q;
      },
      order() {
        return q;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return q;
      },
      insert(row: Row) {
        inserts.push({ table, row });
        inserted = true;
        return q;
      },
      update(patch: Row) {
        updates.push({ table, patch });
        return q;
      },
      upsert(row: Row) {
        upserts.push({ table, row });
        return q;
      },
      async maybeSingle() {
        if (table in singleRows) return { data: singleRows[table], error: null };
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        if (inserted) return { data: { id: `new-${table}-1` }, error: null };
        const row = rows[0] ?? null;
        return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
      },
      then(onF: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(onF);
      },
    };
    return q;
  }

  const client = { from: (table: string) => chain(table), inserts, updates, upserts };
  return client as unknown as AnySupabaseClient & {
    inserts: typeof inserts;
    updates: typeof updates;
    upserts: typeof upserts;
  };
}

function normalizedFixture(overrides: Record<string, unknown> = {}) {
  const result = validateRawProduct(validRaw(overrides));
  if (!result.success) throw new Error('fixture failed validation');
  return normalizeProduct(result.data);
}

// ---------------------------------------------------------------------------
// findDuplicate
// ---------------------------------------------------------------------------

describe('findDuplicate', () => {
  it('matches by GTIN first', async () => {
    const client = fakeClient({ products: [{ id: 'prod-gtin', gtin: '027242920910' }] });
    const out = await findDuplicate(client, normalizedFixture());
    expect(out).toEqual({ existingProductId: 'prod-gtin', isDuplicate: true, matchedBy: 'gtin', confidence: 1 });
  });

  it('falls back to slug when the GTIN does not match', async () => {
    const client = fakeClient({ products: [{ id: 'prod-slug', slug: 'sony-wh-1000xm5' }] });
    const out = await findDuplicate(client, normalizedFixture());
    expect(out).toEqual({ existingProductId: 'prod-slug', isDuplicate: true, matchedBy: 'slug', confidence: 1 });
  });

  it('returns no duplicate when neither GTIN nor slug matches', async () => {
    const client = fakeClient({ products: [{ id: 'other', gtin: '999', slug: 'other' }] });
    const out = await findDuplicate(client, normalizedFixture());
    expect(out).toEqual({ existingProductId: null, isDuplicate: false, matchedBy: null, confidence: null });
  });

  it('skips the GTIN lookup when the product has no GTIN', async () => {
    const client = fakeClient({ products: [{ id: 'prod-slug', slug: 'sony-wh-1000xm5' }] });
    const out = await findDuplicate(client, normalizedFixture({ gtin: undefined }));
    expect(out.matchedBy).toBe('slug');
  });

  it('matches by normalized name+brand when GTIN and slug both miss (§12 #9)', async () => {
    const client = fakeClient({
      products: [{ id: 'prod-nb', name: 'Sony WH-1000XM5', brand: 'Sony', slug: 'sony-wh-1000xm5-black' }],
    });
    const out = await findDuplicate(client, normalizedFixture({ gtin: undefined }));
    expect(out).toEqual({
      existingProductId: 'prod-nb',
      isDuplicate: true,
      matchedBy: 'name-brand',
      confidence: 1,
    });
  });

  it('fuzzy-matches a reworded name within the same brand (§12 #9)', async () => {
    const client = fakeClient({
      products: [
        { id: 'prod-fz', name: 'Sony WH-1000XM5 Wireless', brand: 'Sony', slug: 'sony-wh-1000xm5-wireless' },
      ],
    });
    const out = await findDuplicate(client, normalizedFixture({ gtin: undefined }));
    expect(out.matchedBy).toBe('name-brand-fuzzy');
    expect(out.isDuplicate).toBe(true);
    expect(out.existingProductId).toBe('prod-fz');
    expect(out.confidence).toBeCloseTo(0.75, 5);
  });

  it('does not fuzzy-match a different model of the same brand', async () => {
    const client = fakeClient({
      products: [
        { id: 'prod-pro', name: 'Sony WH-1000XM4', brand: 'Sony', slug: 'sony-wh-1000xm4' },
      ],
    });
    const out = await findDuplicate(client, normalizedFixture({ gtin: undefined }));
    // {sony, wh, 1000xm5} vs {sony, wh, 1000xm4}: 2 shared of 4 = 0.5 < 0.75.
    expect(out.isDuplicate).toBe(false);
  });

  it('returns no duplicate on an empty catalog', async () => {
    const client = fakeClient({});
    const out = await findDuplicate(client, normalizedFixture());
    expect(out.isDuplicate).toBe(false);
  });
});

describe('dedupe text helpers', () => {
  it('normalizeDedupeText lower-cases and collapses non-alphanumerics', () => {
    expect(normalizeDedupeText('Sony WH-1000XM5!')).toBe('sony wh 1000xm5');
    expect(normalizeDedupeText('  MacBook   Air 13-inch ')).toBe('macbook air 13 inch');
  });

  it('nameTokenSimilarity is order-free Jaccard over tokens', () => {
    expect(nameTokenSimilarity('MacBook Air 13', 'Air 13 MacBook')).toBe(1);
    expect(nameTokenSimilarity('MacBook Air 13', 'MacBook Pro 13')).toBe(0.5);
    expect(nameTokenSimilarity('Sony WH-1000XM5', 'Dyson V15')).toBe(0);
    expect(nameTokenSimilarity('', 'Sony')).toBe(0);
  });

  it('NAME_BRAND_FUZZY_THRESHOLD is 0.75', () => {
    expect(NAME_BRAND_FUZZY_THRESHOLD).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// processImages
// ---------------------------------------------------------------------------

describe('processImages', () => {
  it('keeps http(s) URLs, first one primary', async () => {
    const out = await processImages(['https://example.com/a.jpg', 'http://example.com/b.jpg']);
    expect(out).toEqual([
      { url: 'https://example.com/a.jpg', isPrimary: true },
      { url: 'http://example.com/b.jpg', isPrimary: false },
    ]);
  });

  it('drops data: and javascript: URLs (never stored as images)', async () => {
    const out = await processImages([
      'data:image/png;base64,iVBORw0KGgo=',
      'javascript:alert(1)',
      'https://example.com/ok.jpg',
    ]);
    expect(out).toEqual([{ url: 'https://example.com/ok.jpg', isPrimary: true }]);
  });

  it('drops non-http schemes and relative paths', async () => {
    const out = await processImages([
      'ftp://example.com/a.jpg',
      '/local/a.jpg',
      '//example.com/a.jpg',
      'https://example.com/ok.jpg',
    ]);
    expect(out).toEqual([{ url: 'https://example.com/ok.jpg', isPrimary: true }]);
  });

  it('deduplicates identical URLs (after trimming)', async () => {
    const out = await processImages([
      'https://example.com/a.jpg',
      '  https://example.com/a.jpg  ',
      'https://example.com/a.jpg',
    ]);
    expect(out).toHaveLength(1);
  });

  it('caps the list at maxImages', async () => {
    const urls = Array.from({ length: 25 }, (_, i) => `https://example.com/${i}.jpg`);
    expect((await processImages(urls)).length).toBe(20);
    expect((await processImages(urls, { maxImages: 3 })).length).toBe(3);
  });

  it('returns an empty list for empty input', async () => {
    expect(await processImages([])).toEqual([]);
  });

  // Sections 21–25, Stage K (K7) — the placeholder is GONE, so the
  // test now pins the REAL behaviour instead of flagging a gap:
  // with an allowlisted host, a configured bucket and an injected
  // uploader, `uploadToStorage: true` stores the image and returns
  // the stored URL; without any of those three, it keeps the
  // hotlink and says so (uploadStatus 'not-configured'), never
  // claiming a store that did not happen.
  it('uploadToStorage stores an allowlisted image and returns the stored URL', async () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', 'example.com');
    vi.stubEnv('IMAGE_STORAGE_BUCKET', 'test-bucket');
    try {
      const uploaded: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
      const uploader = {
        upload: async (path: string, bytes: Uint8Array, contentType: string) => {
          uploaded.push({ path, bytes, contentType });
          return { path, error: null };
        },
      };
      const fetchFn = (async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'content-type': 'image/jpeg' },
        })) as unknown as typeof fetch;
      const detailed = await processImagesDetailed(['https://example.com/a.jpg'], {
        uploadToStorage: true,
        storageUploader: uploader,
        fetchFn,
      });
      expect(detailed).toHaveLength(1);
      expect(detailed[0].uploadStatus).toBe('stored');
      expect(detailed[0].uploadedUrl).toBe(`test-bucket/${uploaded[0].path}`);
      expect(uploaded).toHaveLength(1);
      expect(uploaded[0].contentType).toBe('image/jpeg');
      // The simple wrapper returns the original URL; the stored
      // URL rides in the detailed result (`uploadedUrl`) — callers
      // that persist images use processImagesDetailed.
      const simple = await processImages(['https://example.com/a.jpg'], {
        uploadToStorage: true,
        storageUploader: uploader,
        fetchFn,
      });
      expect(simple).toEqual([{ url: 'https://example.com/a.jpg', isPrimary: true }]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uploadToStorage keeps the hotlink when the host is not allowlisted', async () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', 'cdn.example.test');
    vi.stubEnv('IMAGE_STORAGE_BUCKET', 'test-bucket');
    try {
      const uploader = {
        upload: async () => ({ path: 'x.jpg', error: null }),
      };
      const fetchFn = (async () =>
        new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
      const detailed = await processImagesDetailed(['https://example.com/a.jpg'], {
        uploadToStorage: true,
        storageUploader: uploader,
        fetchFn,
      });
      expect(detailed).toHaveLength(1);
      expect(detailed[0].uploadStatus).toBe('not-configured');
      expect(detailed[0].uploadedUrl).toBeNull();
      expect(detailed[0].url).toBe('https://example.com/a.jpg');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uploadToStorage keeps the hotlink when no bucket is configured', async () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', 'example.com');
    vi.stubEnv('IMAGE_STORAGE_BUCKET', '');
    try {
      const uploader = {
        upload: async () => ({ path: 'x.jpg', error: null }),
      };
      const fetchFn = (async () =>
        new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
      const detailed = await processImagesDetailed(['https://example.com/a.jpg'], {
        uploadToStorage: true,
        storageUploader: uploader,
        fetchFn,
      });
      expect(detailed[0].uploadStatus).toBe('not-configured');
      expect(detailed[0].uploadedUrl).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---------------------------------------------------------------------------
// assignCategory
// ---------------------------------------------------------------------------

describe('assignCategory', () => {
  it('returns unassigned for a null category', async () => {
    const client = fakeClient({});
    expect(await assignCategory(client, null)).toEqual({
      categoryId: null,
      assigned: false,
      created: false,
      name: null,
    });
  });

  it('matches an existing category by slug without creating', async () => {
    const client = fakeClient({ categories: [{ id: 'cat-1', slug: 'headphones' }] });
    const out = await assignCategory(client, 'Headphones');
    expect(out).toEqual({ categoryId: 'cat-1', assigned: true, created: false, name: 'Headphones' });
    expect(client.inserts).toHaveLength(0);
  });

  it('creates a missing category and returns the leaf name', async () => {
    const client = fakeClient({ categories: [] });
    const out = await assignCategory(client, 'Headphones');
    expect(out).toEqual({
      categoryId: 'new-categories-1',
      assigned: true,
      created: true,
      name: 'Headphones',
    });
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].row.slug).toBe('headphones');
  });

  it('walks a nested path and returns the leaf name', async () => {
    const client = fakeClient({
      categories: [
        { id: 'cat-e', slug: 'electronics' },
        { id: 'cat-h', slug: 'headphones' },
      ],
    });
    const out = await assignCategory(client, 'Electronics > Headphones');
    expect(out.categoryId).toBe('cat-h');
    expect(out.name).toBe('Headphones');
    expect(out.assigned).toBe(true);
  });

  it('ignores empty path parts', async () => {
    const client = fakeClient({ categories: [{ id: 'cat-h', slug: 'headphones' }] });
    const out = await assignCategory(client, ' > Headphones > ');
    expect(out.assigned).toBe(true);
    expect(out.name).toBe('Headphones');
  });
});

// ---------------------------------------------------------------------------
// detectBrand
// ---------------------------------------------------------------------------

describe('detectBrand', () => {
  it('returns undetected for null / blank brand', async () => {
    const client = fakeClient({});
    expect(await detectBrand(client, null)).toEqual({
      brandId: null,
      detected: false,
      created: false,
      name: null,
    });
    expect(await detectBrand(client, '   ')).toEqual({
      brandId: null,
      detected: false,
      created: false,
      name: null,
    });
  });

  it('matches an existing brand by slug and returns its canonical name', async () => {
    const client = fakeClient({ brands: [{ id: 'brand-1', name: 'Sony', slug: 'sony' }] });
    const out = await detectBrand(client, 'sony');
    expect(out).toEqual({ brandId: 'brand-1', detected: true, created: false, name: 'Sony' });
    expect(client.inserts).toHaveLength(0);
  });

  it('matches case-insensitively on name when the slug misses', async () => {
    // Slug lookup misses (no 'sony' slug row), name ilike hits.
    const client = fakeClient(
      { brands: [{ id: 'brand-9', name: 'Sony', slug: 'sony-corp' }] },
      {}
    );
    const out = await detectBrand(client, 'Sony');
    expect(out.brandId).toBe('brand-9');
    expect(out.detected).toBe(true);
    expect(out.created).toBe(false);
  });

  it('creates a new brand when no slug or name matches', async () => {
    const client = fakeClient({ brands: [] });
    const out = await detectBrand(client, 'NewBrand');
    expect(out).toEqual({ brandId: 'new-brands-1', detected: true, created: true, name: 'NewBrand' });
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].row).toMatchObject({ name: 'NewBrand', slug: 'newbrand', active: true });
  });

  it('trims the brand name before matching', async () => {
    const client = fakeClient({ brands: [{ id: 'brand-1', name: 'Sony', slug: 'sony' }] });
    const out = await detectBrand(client, '  Sony  ');
    expect(out.brandId).toBe('brand-1');
    expect(out.name).toBe('Sony');
  });
});

// ---------------------------------------------------------------------------
// ingestProduct / ingestBatch failure paths (module-mocked Supabase)
// ---------------------------------------------------------------------------

/**
 * Ingestion's service client comes from createClient() in
 * @supabase/supabase-js, so the failure-path tests swap that module
 * for a behaviour-configurable fake (same pattern as the Section 18
 * item-23 test in tests/section18-phase2-db-reliability.test.ts).
 */
const ingestState = vi.hoisted(() => ({
  retailerExists: true,
  gtinMatchId: null as string | null,
  slugMatchId: null as string | null,
  productInsertError: null as string | null,
  productInserts: [] as Row[],
  productUpdates: [] as Row[],
  fromCalls: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => {
  type IngRow = Record<string, unknown>;
  const state = ingestState;
  function chain(table: string) {
    const q: Record<string, unknown> = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      neq() {
        return q;
      },
      ilike() {
        return q;
      },
      is() {
        return q;
      },
      in() {
        return q;
      },
      order() {
        return q;
      },
      limit() {
        return q;
      },
      async maybeSingle() {
        if (table === 'retailers')
          return { data: state.retailerExists ? { id: 'retailer-1' } : null, error: null };
        if (table === 'products') {
          if (state.gtinMatchId) return { data: { id: state.gtinMatchId }, error: null };
          if (state.slugMatchId) return { data: { id: state.slugMatchId }, error: null };
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        if (table === 'brands') return { data: { id: 'brand-1' }, error: null };
        if (table === 'categories') return { data: { id: 'cat-1' }, error: null };
        if (table === 'products') {
          if (state.productInsertError)
            return { data: null, error: { message: state.productInsertError } };
          return { data: { id: 'prod-1' }, error: null };
        }
        return { data: null, error: null };
      },
      insert(row: IngRow) {
        if (table === 'products') state.productInserts.push(row);
        return q;
      },
      update(patch: IngRow) {
        if (table === 'products') state.productUpdates.push(patch);
        return q;
      },
      upsert() {
        return q;
      },
      then(onF: (v: { data: IngRow[]; error: null }) => unknown) {
        return Promise.resolve({ data: [], error: null }).then(onF);
      },
    };
    return q;
  }
  return {
    createClient: () => ({
      from: (table: string) => {
        state.fromCalls.push(table);
        return chain(table);
      },
    }),
  };
});

describe('ingestProduct failure paths', () => {
  beforeEach(() => {
    ingestState.retailerExists = true;
    ingestState.gtinMatchId = null;
    ingestState.slugMatchId = null;
    ingestState.productInsertError = null;
    ingestState.productInserts.length = 0;
    ingestState.productUpdates.length = 0;
    ingestState.fromCalls.length = 0;
  });

  it('rejects invalid input before touching the database', async () => {
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(
      { externalId: 'ext-1', retailerSlug: 'amazon', price: -5, currency: 'USD', availability: 'in_stock' } as never,
      'test-provider'
    );
    expect(result.success).toBe(false);
    expect(result.action).toBe('rejected');
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(ingestState.fromCalls).toHaveLength(0);
  });

  it('rejects an unknown retailer', async () => {
    ingestState.retailerExists = false;
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(validRaw(), 'test-provider');
    expect(result.success).toBe(false);
    expect(result.action).toBe('rejected');
    expect(result.errors?.[0]).toContain('Unknown retailer: amazon');
    expect(ingestState.productInserts).toHaveLength(0);
  });

  it('rejects when the product insert fails (error surfaces, not thrown)', async () => {
    ingestState.productInsertError = 'duplicate key value';
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(validRaw(), 'test-provider');
    expect(result.success).toBe(false);
    expect(result.action).toBe('rejected');
    expect(result.errors?.[0]).toContain('Failed to insert product: duplicate key value');
  });

  it('updates instead of creating when the GTIN already exists', async () => {
    ingestState.gtinMatchId = 'prod-existing';
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(validRaw(), 'test-provider');
    expect(result.success).toBe(true);
    expect(result.action).toBe('updated');
    expect(result.productId).toBe('prod-existing');
    expect(result.metadata?.matchedBy).toBe('gtin');
    expect(ingestState.productInserts).toHaveLength(0);
  });

  it('update path writes the RAW confidence score — the 50-floor is gone (§12 #66)', async () => {
    // Sections 21–25, Stage C (B9) — the fixture changed: the
    // gate now applies to UPDATES as well as creates, so the old
    // score-15 / price-0 row is rejected outright (see the next
    // test). This row clears the gate — name + price + known
    // availability scores exactly 30 — but stays below 50, so it
    // still proves the point: the stored score is the raw 30, not
    // floored to 50.
    ingestState.slugMatchId = 'prod-existing';
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const thin = {
      externalId: 'ext-thin',
      retailerSlug: 'amazon',
      name: 'Widget',
      price: 29,
      currency: 'USD',
      availability: 'in_stock' as const,
    };
    const result = await ingestProduct(thin, 'test-provider');
    expect(result.success).toBe(true);
    expect(result.action).toBe('updated');
    // Two products-table writes: the data update, then the
    // Sections 21–25 Stage D stamp of last_successful_update
    // (migration 066) on a successful update.
    expect(ingestState.productUpdates).toHaveLength(2);
    // Was Math.max(score, 50); now the unfloored score (30).
    expect(ingestState.productUpdates[0].confidence_score).toBe(30);
    expect(ingestState.productUpdates[1].last_successful_update).toBeTruthy();
  });

  it('update path rejects a thin row that fails the gate (B9)', async () => {
    ingestState.slugMatchId = 'prod-existing';
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const thin = {
      externalId: 'ext-thin',
      retailerSlug: 'amazon',
      name: 'Widget',
      price: 0,
      currency: 'USD',
      availability: 'unknown' as const,
    };
    const result = await ingestProduct(thin, 'test-provider');
    expect(result.success).toBe(false);
    expect(result.action).toBe('rejected');
    expect(result.errors?.join(' ')).toContain('Ingest gate');
    expect(ingestState.productUpdates).toHaveLength(0);
  });

  it('create path rejects a thin product below the confidence gate (§12 #16)', async () => {
    const { ingestProduct, PIPELINE_MIN_CONFIDENCE_SCORE } = await import(
      '@/services/pipeline/ingestion'
    );
    expect(PIPELINE_MIN_CONFIDENCE_SCORE).toBe(30);
    const thin = {
      externalId: 'ext-thin',
      retailerSlug: 'amazon',
      name: 'Widget',
      price: 0,
      currency: 'USD',
      availability: 'unknown' as const,
    };
    const result = await ingestProduct(thin, 'test-provider');
    expect(result.success).toBe(false);
    expect(result.action).toBe('rejected');
    expect(result.errors).toContain(
      'Ingest gate: confidence score 15 is below the minimum 30'
    );
    expect(result.errors).toContain(
      'Ingest gate: price must be greater than 0 (no free-price flag exists)'
    );
    expect(ingestState.productInserts).toHaveLength(0);
  });

  it('create path rejects a price-0 product even when confidence clears the gate', async () => {
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    // name 15 + description 15 = 30, exactly at the gate — but price 0.
    const zeroPrice = {
      externalId: 'ext-zero',
      retailerSlug: 'amazon',
      name: 'Widget',
      description: 'A widget with a description',
      price: 0,
      currency: 'USD',
      availability: 'unknown' as const,
    };
    const result = await ingestProduct(zeroPrice, 'test-provider');
    expect(result.success).toBe(false);
    expect(result.action).toBe('rejected');
    expect(result.errors).toEqual([
      'Ingest gate: price must be greater than 0 (no free-price flag exists)',
    ]);
  });

  it('creates a new product on the happy path', async () => {
    const { ingestProduct } = await import('@/services/pipeline/ingestion');
    const result = await ingestProduct(validRaw(), 'test-provider');
    expect(result.success).toBe(true);
    expect(result.action).toBe('created');
    expect(result.productId).toBe('prod-1');
    expect(ingestState.productInserts).toHaveLength(1);
    expect(ingestState.productInserts[0].confidence_score).toBe(100);
  });

  it('ingestBatch returns one result per input, failures included', async () => {
    const { ingestBatch } = await import('@/services/pipeline/ingestion');
    const results = await ingestBatch(
      [
        validRaw(),
        { externalId: 'ext-bad', retailerSlug: 'amazon', price: -1, currency: 'USD', availability: 'in_stock' } as never,
      ],
      'test-provider'
    );
    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].action).toBe('rejected');
  });
});
