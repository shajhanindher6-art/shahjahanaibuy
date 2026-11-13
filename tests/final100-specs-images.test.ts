/**
 * FINAL 100% — Worker W4 (specs + images) regression tests.
 *
 * Covers F-P1-39/40/22/23/24/07/08/09/10/27, F-P2-13/25/26/27/28/
 * 29/30/31/32/33/34/35, F-P2-09/10. Pure functions are tested
 * directly; DB-backed helpers run against a small in-memory fake
 * Supabase client (no network, no live data). Nothing here invents
 * a spec, GTIN, image or product — every expected value is
 * hand-computed from the input in the test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeSpecValue } from '@/lib/spec-value-normalization';
import {
  validateModelNumber,
  assessIdentityPrecision,
} from '@/lib/model-identity';
import {
  SPEC_TEMPLATES,
  assessSpecCompleteness,
  listCategoriesWithoutSpecTemplates,
  specTemplateForCategory,
  validateSpecEntries,
} from '@/lib/spec-templates';
import {
  getAllowedImageHosts,
  getImageAllowlistConfig,
  isAllowedImageHost,
} from '@/lib/image-allowlist';
import {
  buildImageVariants,
  checkImageAccessible,
  computeImageContentHash,
  findCrossProductDuplicateImages,
  getImageAllowlist,
  getImagePipelineConfig,
  hashImageUrl,
  isImageHostAllowlisted,
  normalizeImageUrl,
  processImagesDetailed,
  clearImageValidationCacheForTests,
} from '@/services/pipeline/image-processing';
import {
  parseIntakeCsv,
  parseSpecColumn,
  parseVariantColumn,
  planIntakeInsert,
  reviewIntakeRows,
  type IntakeCatalogContext,
} from '@/services/catalog-intake';
import { buildProductAttributeRow } from '@/services/product-attributes';
import {
  deriveImageAltText,
  getProductImagesWithVerification,
  insertProductImagesWithVerification,
} from '@/services/product-images';
import {
  listCategoriesMissingSpecTemplates,
  listProductImageStatus,
  listSpecCompleteness,
  validateAdminProductPatch,
} from '@/services/admin-products';
import {
  planBrandCategoryLinks,
  applyBrandCategoryLinks,
} from '@/services/brand-category-backfill';
import { buildProductMetadata, type ProductSeoData } from '@/lib/product-seo';

// ---------------------------------------------------------------------------
// F-P2-35 — spec value normalization
// ---------------------------------------------------------------------------

describe('normalizeSpecValue (F-P2-35)', () => {
  it('spaces a number glued to its unit ("16GB" → "16 GB", "200MP" → "200 MP")', () => {
    expect(normalizeSpecValue('16GB').value).toBe('16 GB');
    expect(normalizeSpecValue('200MP').value).toBe('200 MP');
    expect(normalizeSpecValue('6.1inch').value).toBe('6.1 inch');
  });
  it('turns a leading number word into digits ("sixteen GB" → "16 GB")', () => {
    expect(normalizeSpecValue('sixteen GB').value).toBe('16 GB');
    expect(normalizeSpecValue('eight').value).toBe('8');
  });
  it('appends a supplied unit to a bare number ("16" + GB → "16 GB")', () => {
    expect(normalizeSpecValue('16', 'GB').value).toBe('16 GB');
  });
  it('leaves names alone and is idempotent ("Apple M4" stays "Apple M4")', () => {
    expect(normalizeSpecValue('Apple M4').value).toBe('Apple M4');
    const once = normalizeSpecValue('16GB').value;
    expect(normalizeSpecValue(once).value).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// F-P1-07 / F-P1-27 — model identity precision
// ---------------------------------------------------------------------------

describe('validateModelNumber + assessIdentityPrecision (F-P1-07, F-P1-27)', () => {
  it('accepts a digit-bearing model number and rejects a digit-less family word', () => {
    expect(validateModelNumber('M4 2024').valid).toBe(true);
    expect(validateModelNumber('Air').valid).toBe(false);
    expect(validateModelNumber('  ').valid).toBe(false);
  });
  it('flags a family name as imprecise until model + generation are recorded', () => {
    const flagged = assessIdentityPrecision({ name: 'MacBook Air 13' });
    expect(flagged.precision).toBe('imprecise');
    expect(flagged.reasons.length).toBe(2);
    const precise = assessIdentityPrecision({
      name: 'MacBook Air 13',
      modelNumber: 'M4 2024',
      generation: 'M4',
    });
    expect(precise.precision).toBe('precise');
  });
});

// ---------------------------------------------------------------------------
// F-P2-13 / F-P1-09 / F-P2-32 — templates + completeness
// ---------------------------------------------------------------------------

describe('spec templates (F-P2-13, F-P1-09, F-P2-32)', () => {
  it('covers Gaming and Home electronics (11 categories)', () => {
    expect(specTemplateForCategory('Gaming')).not.toBeNull();
    expect(specTemplateForCategory('Home electronics')).not.toBeNull();
    expect(Object.keys(SPEC_TEMPLATES)).toHaveLength(11);
    expect(specTemplateForCategory('gaming')?.map((e) => e.key)).toContain('refresh_rate');
    expect(specTemplateForCategory('home electronics')?.map((e) => e.key)).toContain('power');
  });
  it('flags missing required keys and reports unknown keys (never silently drops)', () => {
    const assessment = assessSpecCompleteness('laptop', ['ram', 'bogus_key']);
    expect(assessment.missingKeys).toContain('storage');
    expect(assessment.unknownKeys).toEqual(['bogus_key']);
    expect(assessment.complete).toBe(false);
    expect(assessSpecCompleteness('laptop', ['processor', 'ram', 'storage', 'display', 'graphics', 'battery', 'os']).complete).toBe(true);
  });
  it('lists categories without a template', () => {
    expect(listCategoriesWithoutSpecTemplates(['Laptops', 'Toasters', 'Gaming', null])).toEqual([
      'Toasters',
    ]);
  });
  it('normalizes spec values through validateSpecEntries', () => {
    const result = validateSpecEntries('laptop', [{ key: 'ram', value: '16GB' }]);
    expect(result.valid).toBe(true);
    expect(result.validEntries[0].value).toBe('16 GB');
  });
});

// ---------------------------------------------------------------------------
// F-P2-25 / F-P1-08 — one canonical allowlist (exact-host)
// ---------------------------------------------------------------------------

describe('image allowlist unification (F-P2-25, F-P1-08)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('the pipeline allowlist now agrees with the canonical one: subdomains do NOT match', () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', 'example.com');
    expect(isAllowedImageHost('https://example.com/x.jpg')).toBe(true);
    expect(isAllowedImageHost('https://evil.example.com/x.jpg')).toBe(false);
    expect(isImageHostAllowlisted('https://example.com/x.jpg')).toBe(true);
    expect(isImageHostAllowlisted('https://evil.example.com/x.jpg')).toBe(false);
    expect(getImageAllowlist()).toEqual(['example.com']);
  });
  it('the config says plainly that no host is known when unset (F-P1-41)', () => {
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', '');
    const config = getImageAllowlistConfig();
    expect(config.configured).toBe(false);
    expect(config.status).toContain('no merchant image host is known yet');
    expect(getAllowedImageHosts()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F-P2-28 — URL normalization + dedupe + content hash
// ---------------------------------------------------------------------------

describe('image URL normalization + dedupe (F-P2-28)', () => {
  it('normalizes scheme/host case, default ports, trailing slashes; keeps the query as-is', () => {
    expect(normalizeImageUrl('HTTPS://Example.COM:443/x.jpg/')).toBe('https://example.com/x.jpg');
    expect(normalizeImageUrl('https://images.example.com/x.jpg?b=2&a=1')).toBe('https://images.example.com/x.jpg?b=2&a=1');
  });
  it('hashes the same image the same way under two spellings, differently for different URLs', () => {
    expect(hashImageUrl('HTTPS://IMAGES.EXAMPLE.COM/x.jpg/')).toBe(hashImageUrl('https://images.example.com/x.jpg'));
    expect(hashImageUrl('https://images.example.com/a.jpg')).not.toBe(hashImageUrl('https://images.example.com/b.jpg'));
  });
  it('finds the same image under two products (cross-product dedupe)', () => {
    const dupes = findCrossProductDuplicateImages([
      { productId: 'p1', url: 'https://images.example.com/x.jpg' },
      { productId: 'p2', url: 'HTTPS://IMAGES.EXAMPLE.COM/x.jpg/' },
      { productId: 'p3', url: 'https://images.example.com/y.jpg' },
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].productIds.sort()).toEqual(['p1', 'p2']);
  });
  it('hashes identical bytes identically (content hash)', async () => {
    const bytes = new TextEncoder().encode('fake-image-bytes');
    const a = await computeImageContentHash(bytes);
    const b = await computeImageContentHash(new TextEncoder().encode('fake-image-bytes'));
    const c = await computeImageContentHash(new TextEncoder().encode('other-bytes'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });
  it('dedupes normalized URLs in processImagesDetailed', async () => {
    clearImageValidationCacheForTests();
    const out = await processImagesDetailed([
      'https://images.example.com/x.jpg',
      'HTTPS://H/x.jpg/',
      'https://images.example.com/y.jpg',
    ]);
    expect(out.map((i) => i.url)).toEqual(['https://images.example.com/x.jpg', 'https://images.example.com/y.jpg']);
  });
  it('buildImageVariants returns null without a CDN base (never fabricated)', () => {
    vi.stubEnv('IMAGE_CDN_BASE', '');
    expect(buildImageVariants('https://images.example.com/x.jpg')).toBeNull();
    vi.unstubAllEnvs();
  });
  it('pipeline config is off by default and honest about it', () => {
    vi.stubEnv('IMAGE_PIPELINE_CHECK_ACCESSIBILITY', '');
    vi.stubEnv('IMAGE_PIPELINE_UPLOAD_TO_STORAGE', '');
    vi.stubEnv('IMAGE_STORAGE_BUCKET', '');
    vi.stubEnv('IMAGE_ALLOWED_HOSTS', '');
    const config = getImagePipelineConfig();
    expect(config.checkAccessibility).toBe(false);
    expect(config.uploadToStorage).toBe(false);
    expect(config.storageConfigured).toBe(false);
    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// F-P2-29 — broken-image detection (HEAD check)
// ---------------------------------------------------------------------------

describe('checkImageAccessible (F-P2-29)', () => {
  it('reports reachable only for a 2xx image content-type', async () => {
    const okFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })) as unknown as typeof fetch;
    expect((await checkImageAccessible('https://images.example.com/x.jpg', okFetch)).reachable).toBe(true);
    const htmlFetch = (async () =>
      new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const bad = await checkImageAccessible('https://images.example.com/x.jpg', htmlFetch);
    expect(bad.reachable).toBe(false);
    expect(bad.reason).toContain('not an image');
  });
});

// ---------------------------------------------------------------------------
// F-P1-22 / F-P1-23 / F-P2-09 / F-P1-07 — CSV specs / GTIN / variants / model
// ---------------------------------------------------------------------------

const CSV_CONTEXT: IntakeCatalogContext = {
  existingSlugs: new Set(),
  existingNameBrands: new Map(),
  existingGtins: new Map(),
  knownMerchants: new Map([['amazon', 'm-amazon']]),
  knownCurrencies: new Map([['USD', 'c-usd']]),
};

function csvRow(overrides: Record<string, string> = {}): string {
  const base = {
    name: 'Test Laptop',
    slug: 'test-laptop',
    brand: 'TestBrand',
    category: 'Laptops',
    price: '999',
    currency: 'USD',
    merchant: 'Amazon',
    specs: 'ram: 16GB; storage: 512 GB',
    variants: '16 GB / 512 GB~SKU-1~~ram=16 GB,storage=512 GB',
    model_number: 'M4 2024',
    image_urls: 'https://images.example.com/a.jpg; https://images.example.com/b.jpg',
  };
  const row = { ...base, ...overrides };
  const headers = Object.keys(row).join(',');
  const values = Object.values(row)
    .map((v) => `"${v.replace(/"/g, '""')}"`)
    .join(',');
  return `${headers}\n${values}`;
}

describe('CSV specs / variants / GTIN / model (F-P1-22, F-P1-23, F-P2-09, F-P1-07)', () => {
  it('parses the specs column and validates it against the template', () => {
    expect(parseSpecColumn('ram: 16 GB; storage: 512 GB').specs).toEqual([
      { key: 'ram', value: '16 GB' },
      { key: 'storage', value: '512 GB' },
    ]);
    expect(parseSpecColumn('ram 16 GB').errors).toHaveLength(1);
  });
  it('parses the compact variant column and the JSON variant column', () => {
    const compact = parseVariantColumn('16 GB / 512 GB~SKU-1~~ram=16 GB,storage=512 GB');
    expect(compact.variants[0].name).toBe('16 GB / 512 GB');
    expect(compact.variants[0].attributes).toEqual({ ram: '16 GB', storage: '512 GB' });
    const json = parseVariantColumn('[{"name":"8 GB / 256 GB","sku":"SKU-2"}]');
    expect(json.variants[0].sku).toBe('SKU-2');
  });
  it('a valid row reviews valid with specs + variants + gallery URLs in the plan', () => {
    const { rows } = parseIntakeCsv(csvRow());
    const review = reviewIntakeRows(rows, CSV_CONTEXT);
    expect(review.rows[0].status).toBe('valid');
    expect(review.rows[0].data?.specs).toEqual([
      { key: 'ram', value: '16 GB' },
      { key: 'storage', value: '512 GB' },
    ]);
    expect(review.rows[0].data?.variants?.[0].name).toBe('16 GB / 512 GB');
    const plans = planIntakeInsert(review.rows);
    expect(plans[0].galleryUrls).toEqual(['https://images.example.com/a.jpg', 'https://images.example.com/b.jpg']);
    expect(plans[0].specs).toHaveLength(2);
  });
  it('an unknown spec key holds the row with a reason (never silently dropped)', () => {
    const { rows } = parseIntakeCsv(csvRow({ specs: 'quantum_flux: yes' }));
    const review = reviewIntakeRows(rows, CSV_CONTEXT);
    expect(review.rows[0].status).toBe('error');
    expect(review.rows[0].errors.some((e) => e.field === 'specs')).toBe(true);
  });
  it('an invalid variant GTIN holds the row with a reason', () => {
    const { rows } = parseIntakeCsv(
      csvRow({ variants: '8 GB~SKU-9~12345678~ram=8 GB' })
    );
    const review = reviewIntakeRows(rows, CSV_CONTEXT);
    expect(review.rows[0].status).toBe('error');
    expect(review.rows[0].errors.some((e) => e.field === 'variants')).toBe(true);
  });
  it('a digit-less model number holds the row; a missing one does not', () => {
    const bad = parseIntakeCsv(csvRow({ model_number: 'Air' }));
    expect(reviewIntakeRows(bad.rows, CSV_CONTEXT).rows[0].status).toBe('error');
    const missing = parseIntakeCsv(csvRow({ model_number: '' }));
    expect(reviewIntakeRows(missing.rows, CSV_CONTEXT).rows[0].status).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// F-P2-30 / F-P1-40 — alt text + verification persistence (fake client)
// ---------------------------------------------------------------------------

type FakeTable = Record<string, unknown>[];
interface FakeDb {
  tables: Record<string, FakeTable>;
  failInsertWith42703?: boolean;
}

function fakeSupabase(db: FakeDb): unknown {
  const makeQuery = (table: string) => {
    let inserted: Record<string, unknown>[] | null = null;
    const query: Record<string, unknown> = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => query,
      insert: (rows: Record<string, unknown>[]) => {
        if (db.failInsertWith42703 && rows[0] && 'verification_status' in rows[0]) {
          return Promise.resolve({
            data: null,
            error: { code: '42703', message: 'column "verification_status" does not exist' },
          });
        }
        (db.tables[table] ??= []).push(...rows);
        inserted = rows;
        return Promise.resolve({ data: rows, error: null });
      },
      update: () => query,
      delete: () => query,
      in: () => query,
      is: () => query,
      single: () => Promise.resolve({ data: inserted?.[0] ?? null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        const rows = db.tables[table] ?? [];
        resolve({ data: rows, error: null });
      },
    };
    return query;
  };
  return { from: (table: string) => makeQuery(table) };
}

describe('product gallery images (F-P2-30, F-P1-40)', () => {
  it('derives honest alt text from the product name (never invented content)', () => {
    expect(deriveImageAltText('MacBook Air 13', true, 0)).toBe('MacBook Air 13');
    expect(deriveImageAltText('MacBook Air 13', false, 1)).toBe('MacBook Air 13 photo 2');
  });
  it('stores verification status + alt text, and falls back honestly on 42703', async () => {
    const db: FakeDb = { tables: { product_images: [] } };
    const client = fakeSupabase(db) as never;
    const detailed = await processImagesDetailed(['https://images.example.com/x.jpg']);
    const ok = await insertProductImagesWithVerification(client, 'p1', {
      images: detailed,
      productName: 'Test Laptop',
    });
    expect(ok.inserted).toBe(1);
    expect(ok.verificationMissing).toBe(false);
    const stored = db.tables.product_images[0] as Record<string, unknown>;
    expect(stored.alt_text).toBe('Test Laptop');
    expect(stored.verification_status).toBe('unchecked');

    const legacyDb: FakeDb = { tables: { product_images: [] }, failInsertWith42703: true };
    const legacy = await insertProductImagesWithVerification(
      fakeSupabase(legacyDb) as never,
      'p1',
      { images: detailed, productName: 'Test Laptop' }
    );
    expect(legacy.inserted).toBe(1);
    expect(legacy.verificationMissing).toBe(true);
    expect('verification_status' in (legacyDb.tables.product_images[0] as object)).toBe(false);
  });
  it('reads verification status, degrading to null when 069 is unapplied', async () => {
    const db: FakeDb = {
      tables: {
        product_images: [
          {
            id: 'i1',
            url: 'https://images.example.com/x.jpg',
            alt_text: 'Test',
            is_primary: true,
            sort_order: 0,
            verification_status: 'verified',
            checked_at: '2026-11-13T00:00:00Z',
          },
        ],
      },
    };
    const read = await getProductImagesWithVerification(fakeSupabase(db) as never, 'p1');
    expect(read.images[0].verificationStatus).toBe('verified');
    expect(read.verificationMissing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-P2-27 / F-P2-29 / F-P1-09 / F-P2-32 — admin PATCH + review queues
// ---------------------------------------------------------------------------

describe('admin image validation + review queues (F-P2-27, F-P2-29, F-P1-09, F-P2-32)', () => {
  it('PATCH image_url uses the full validator: credentials and bare hosts rejected', () => {
    const creds = validateAdminProductPatch({ image_url: 'https://user:pass@h/x.jpg' });
    expect(creds.patch).toBeNull();
    expect(creds.error).toContain('credentials');
    const bare = validateAdminProductPatch({ image_url: 'https://localhost/x.jpg' });
    expect(bare.patch).toBeNull();
    expect(validateAdminProductPatch({ image_url: 'https://images.example.com/x.jpg' }).patch).toEqual({
      image_url: 'https://images.example.com/x.jpg',
    });
  });
  it('listProductImageStatus flags a broken image only when reachability is checked', async () => {
    const db: FakeDb = {
      tables: {
        products: [{ id: 'p1', name: 'A', slug: 'a', image_url: 'https://images.example.com/x.jpg' }],
        product_images: [],
      },
    };
    const client = fakeSupabase(db) as never;
    const shapeOnly = await listProductImageStatus(client, 50);
    expect(shapeOnly.rows[0].status).toBe('ok');
    expect(shapeOnly.rows[0].reachable).toBeNull();
    expect(shapeOnly.reachabilityChecked).toBe(false);
    const failingFetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof fetch;
    const checked = await listProductImageStatus(client, 50, {
      checkReachability: true,
      fetchFn: failingFetch,
    });
    expect(checked.rows[0].status).toBe('broken-image');
    expect(checked.rows[0].reachable).toBe(false);
    expect(checked.reachabilityChecked).toBe(true);
  });
  it('listSpecCompleteness flags missing keys; missing-template categories are listed', async () => {
    const db: FakeDb = {
      tables: {
        products: [
          { id: 'p1', name: 'Laptop', slug: 'laptop', category: 'Laptops' },
          { id: 'p2', name: 'Toaster', slug: 'toaster', category: 'Toasters' },
        ],
        product_attributes: [{ product_id: 'p1', key: 'ram' }],
      },
    };
    const client = fakeSupabase(db) as never;
    const completeness = await listSpecCompleteness(client, 50);
    const laptop = completeness.rows.find((r) => r.productId === 'p1');
    expect(laptop?.missingKeys).toContain('storage');
    expect(laptop?.complete).toBe(false);
    const templates = await listCategoriesMissingSpecTemplates(client);
    expect(templates.categories).toEqual(['Toasters']);
  });
});

// ---------------------------------------------------------------------------
// F-P2-33 — social meta: og:image only when an image is not known-broken
// ---------------------------------------------------------------------------

function seo(overrides: Partial<ProductSeoData>): ProductSeoData {
  return {
    id: 'p1',
    name: 'Test Laptop',
    slug: 'test-laptop',
    description: null,
    brand: null,
    category: null,
    imageUrl: 'https://images.example.com/x.jpg',
    gtin: null,
    confidenceScore: 0,
    lowestPrice: null,
    dataFreshness: null,
    priceValidUntil: null,
    inStock: null,
    averageRating: 0,
    reviewCount: 0,
    ...overrides,
  };
}

describe('buildProductMetadata social image (F-P2-33)', () => {
  it('emits og:image + twitter:image for a verified image', () => {
    const meta = buildProductMetadata(seo({ imageVerificationStatus: 'verified' }), 'https://example.com');
    expect((meta.openGraph as { images?: unknown }).images).toEqual([
      { url: 'https://images.example.com/x.jpg', alt: 'Test Laptop' },
    ]);
    expect((meta.twitter as { images?: unknown }).images).toEqual(['https://images.example.com/x.jpg']);
  });
  it('suppresses social images for a known-unreachable image and when there is no image', () => {
    const broken = buildProductMetadata(seo({ imageVerificationStatus: 'unreachable' }), 'https://example.com');
    expect((broken.openGraph as { images?: unknown }).images).toBeUndefined();
    expect((broken.twitter as { images?: unknown }).images).toBeUndefined();
    const none = buildProductMetadata(seo({ imageUrl: null }), 'https://example.com');
    expect((none.openGraph as { images?: unknown }).images).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F-P2-10 — brand/category backfill planning (dry-run default)
// ---------------------------------------------------------------------------

describe('brand/category backfill (F-P2-10)', () => {
  it('plans exact normalized matches and never auto-creates rows', async () => {
    const db: FakeDb = {
      tables: {
        products: [
          { id: 'p1', slug: 'a', brand: 'Apple', category: 'Laptops', brand_id: null, category_id: null },
          { id: 'p2', slug: 'b', brand: 'NoSuchBrand', category: 'Laptops', brand_id: null, category_id: null },
        ],
        brands: [{ id: 'b-apple', name: 'Apple' }],
        categories: [{ id: 'c-laptops', name: 'Laptops' }],
      },
    };
    const client = fakeSupabase(db) as never;
    const plan = await planBrandCategoryLinks(client);
    expect(plan.linkable).toBe(2); // p2 links by category even though its brand is unknown
    expect(plan.rows.find((r) => r.productId === 'p1')?.brandId).toBe('b-apple');
    expect(plan.rows.find((r) => r.productId === 'p2')?.reason).toContain('NoSuchBrand');
    const dry = await applyBrandCategoryLinks(client, plan);
    expect(dry.dryRun).toBe(true);
    expect(dry.updated).toBe(2); // both rows would change (p1 brand+category, p2 category)
    // Dry run writes nothing.
    expect((db.tables.products[0] as Record<string, unknown>).brand_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F-P2-35 (write path) — buildProductAttributeRow normalizes values
// ---------------------------------------------------------------------------

describe('buildProductAttributeRow normalizes values at write time (F-P2-35)', () => {
  it('stores "16 GB" for a "16GB" entry', () => {
    const built = buildProductAttributeRow('p1', 'Laptops', { key: 'ram', value: '16GB' });
    expect(built.row?.value).toBe('16 GB');
  });
});
