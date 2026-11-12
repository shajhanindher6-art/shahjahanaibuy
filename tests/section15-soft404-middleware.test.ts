/**
 * Soft-404 middleware tests — the pre-render slug existence check.
 *
 * BACKGROUND (proven 2026-11-12, minimal Next 13.5.9 repro app):
 * the [slug]/layout.tsx existence checks cannot produce HTTP 404
 * live because app/loading.tsx (root shell) streams with 200 before
 * ANY notFound() runs — async OR sync. The fix moves the check
 * BEFORE rendering, into middleware: an unknown slug is rewritten
 * to /__smartbuy_not_found__, a path that matches NO route, so Next
 * returns its routing-level 404 (the real app/not-found.tsx UI,
 * HTTP 404) without rendering anything.
 *
 * These tests cover the middleware decision with a mocked fetch:
 * known slug -> pass, unknown slug -> rewrite, and EVERY failure
 * mode (Supabase error, timeout/abort, missing env) -> pass
 * (fail-open). The HTTP status itself is re-verified by the live
 * recheck after push, and by the repro proof (see the fix report).
 *
 * DESIGN NOTE (2026-11-12): the rewrite target is a path that
 * matches NO route (/__smartbuy_not_found__), so Next returns its
 * routing-level 404 with the real not-found UI. An earlier draft
 * rewrote to a sync /gone route that called notFound() — the repro
 * PROVED that still returns 200 while the root loading.tsx exists,
 * so /gone was deleted and is pinned absent below.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  matchSlugRoute,
  slugifySlugValue,
  slugExists,
  resolveSlugRequest,
  type SlugCheckEnv,
} from '@/lib/middleware/slug-exists';

const TEST_ENV: SlugCheckEnv = {
  supabaseUrl: 'https://test.supabase.co',
  supabaseAnonKey: 'test-anon-key',
};

function mockFetchJson(rows: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => rows,
  })) as unknown as typeof fetch;
}

describe('matchSlugRoute', () => {
  it('matches the three slug routes with the right kind', () => {
    expect(matchSlugRoute('/products/macbook-air-13')).toEqual({
      kind: 'product',
      slug: 'macbook-air-13',
    });
    expect(matchSlugRoute('/brands/apple')).toEqual({
      kind: 'brand',
      slug: 'apple',
    });
    expect(matchSlugRoute('/categories/laptops')).toEqual({
      kind: 'category',
      slug: 'laptops',
    });
  });

  it('does not match index pages, deeper paths, or other routes', () => {
    expect(matchSlugRoute('/products')).toBeNull();
    expect(matchSlugRoute('/brands')).toBeNull();
    expect(matchSlugRoute('/categories')).toBeNull();
    expect(matchSlugRoute('/products/')).toBeNull();
    expect(matchSlugRoute('/products/a/b')).toBeNull();
    expect(matchSlugRoute('/api/v1/products')).toBeNull();
    expect(matchSlugRoute('/')).toBeNull();
    expect(matchSlugRoute('/tools/coupons-cashback')).toBeNull();
  });

  it('decodes percent-encoded slugs and rejects malformed encoding', () => {
    expect(matchSlugRoute('/products/macbook%20air')).toEqual({
      kind: 'product',
      slug: 'macbook air',
    });
    expect(matchSlugRoute('/products/%E0%A4%A')).toBeNull();
  });
});

describe('slugifySlugValue', () => {
  it('mirrors lib/brand-category-seo.ts slugify', () => {
    expect(slugifySlugValue('Apple Inc.')).toBe('apple-inc');
    expect(slugifySlugValue('Home & Garden')).toBe('home-garden');
    expect(slugifySlugValue('  Sony  ')).toBe('sony');
    expect(slugifySlugValue('Laptops')).toBe('laptops');
  });
});

describe('slugExists — products', () => {
  it('returns true when the products row exists', async () => {
    const fetchMock = mockFetchJson([{ slug: 'macbook-air-13' }]);
    const exists = await slugExists(
      'product',
      'macbook-air-13',
      TEST_ENV,
      fetchMock
    );
    expect(exists).toBe(true);
    const url = String((fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain('/rest/v1/products?slug=eq.macbook-air-13');
    expect(url).toContain('deleted_at=is.null');
    expect(url).toContain('slug=neq.sample-laptop');
    expect(url).toContain('select=slug&limit=1');
  });

  it('returns false for an unknown slug', async () => {
    const fetchMock = mockFetchJson([]);
    expect(
      await slugExists('product', 'does-not-exist-xyz', TEST_ENV, fetchMock)
    ).toBe(false);
  });

  it('never counts the sample-laptop health-check row as existing', async () => {
    // The neq filter is in the URL, so Supabase returns [] for it.
    const fetchMock = mockFetchJson([]);
    expect(
      await slugExists('product', 'sample-laptop', TEST_ENV, fetchMock)
    ).toBe(false);
    const url = String(
      (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    );
    expect(url).toContain('slug=neq.sample-laptop');
  });

  it('sends the anon key as apikey + Bearer and uses the 2s timeout signal', async () => {
    const fetchMock = mockFetchJson([{ slug: 'x' }]);
    await slugExists('product', 'x', TEST_ENV, fetchMock);
    const [, init] = (fetchMock as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, Record<string, unknown>];
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe('test-anon-key');
    expect(headers.Authorization).toBe('Bearer test-anon-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on a non-200 from Supabase', async () => {
    const fetchMock = mockFetchJson({ message: 'boom' }, false, 500);
    await expect(
      slugExists('product', 'x', TEST_ENV, fetchMock)
    ).rejects.toThrow('HTTP 500');
  });

  it('throws when env is missing', async () => {
    const fetchMock = mockFetchJson([]);
    await expect(
      slugExists(
        'product',
        'x',
        { supabaseUrl: null, supabaseAnonKey: null },
        fetchMock
      )
    ).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('slugExists — brands / categories (product-derived)', () => {
  it('matches a brand by slugifying the product brand column', async () => {
    const fetchMock = mockFetchJson([
      { brand: 'Apple' },
      { brand: 'Samsung' },
      { brand: null },
    ]);
    expect(
      await slugExists('brand', 'apple', TEST_ENV, fetchMock)
    ).toBe(true);
    expect(
      await slugExists('brand', 'sony', TEST_ENV, fetchMock)
    ).toBe(false);
    const url = String(
      (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    );
    expect(url).toContain('/rest/v1/products?select=brand');
  });

  it('matches a category by slugifying the product category column', async () => {
    const fetchMock = mockFetchJson([
      { category: 'Laptops' },
      { category: 'Smartphones' },
    ]);
    expect(
      await slugExists('category', 'laptops', TEST_ENV, fetchMock)
    ).toBe(true);
    expect(
      await slugExists('category', 'cameras', TEST_ENV, fetchMock)
    ).toBe(false);
  });
});

describe('resolveSlugRequest — the middleware decision', () => {
  it('passes non-slug routes through without calling fetch', async () => {
    const fetchMock = mockFetchJson([]);
    expect(await resolveSlugRequest('/products', TEST_ENV, fetchMock)).toBe(
      'pass'
    );
    expect(await resolveSlugRequest('/', TEST_ENV, fetchMock)).toBe('pass');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes known slugs and rewrites unknown slugs', async () => {
    const known = mockFetchJson([{ slug: 'macbook-air-13' }]);
    expect(
      await resolveSlugRequest(
        '/products/macbook-air-13',
        TEST_ENV,
        known
      )
    ).toBe('pass');
    const unknown = mockFetchJson([]);
    expect(
      await resolveSlugRequest(
        '/products/does-not-exist-xyz',
        TEST_ENV,
        unknown
      )
    ).toBe('rewrite');
    const unknownBrand = mockFetchJson([{ brand: 'Apple' }]);
    expect(
      await resolveSlugRequest('/brands/does-not-exist-xyz', TEST_ENV, unknownBrand)
    ).toBe('rewrite');
  });

  it('fails open on fetch rejection (network / timeout)', async () => {
    const failing = vi.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    expect(
      await resolveSlugRequest('/products/does-not-exist-xyz', TEST_ENV, failing)
    ).toBe('pass');
  });

  it('fails open on a non-200 from Supabase', async () => {
    const bad = mockFetchJson({ message: 'boom' }, false, 500);
    expect(
      await resolveSlugRequest('/products/does-not-exist-xyz', TEST_ENV, bad)
    ).toBe('pass');
  });

  it('fails open when env is missing (dev without Supabase env)', async () => {
    const fetchMock = mockFetchJson([]);
    expect(
      await resolveSlugRequest(
        '/products/does-not-exist-xyz',
        { supabaseUrl: null, supabaseAnonKey: null },
        fetchMock
      )
    ).toBe('pass');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('middleware wiring (structural pins)', () => {
  it('middleware.ts keeps its existing behaviour and adds the slug check', () => {
    const src = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    // Existing behaviour preserved:
    expect(src).toContain('updateSession');
    expect(src).toContain('Content-Security-Policy');
    expect(src).toContain('sb-country');
    // New check, before the session work, rewriting to a path that
    // matches NO route (routing-level 404 with the real UI):
    expect(src).toContain('resolveSlugRequest');
    expect(src).toContain('NextResponse.rewrite(');
    expect(src).toContain("'/__smartbuy_not_found__'");
    expect(src.indexOf('await resolveSlugRequest')).toBeLessThan(
      src.indexOf('await updateSession')
    );
  });

  it('no route exists at the rewrite target, and /gone is gone', () => {
    // A route at /__smartbuy_not_found__ would silently break the
    // 404 (the rewrite would render it with 200 instead).
    expect(
      existsSync(join(process.cwd(), 'app/__smartbuy_not_found__'))
    ).toBe(false);
    expect(existsSync(join(process.cwd(), 'app/gone'))).toBe(false);
  });
});
