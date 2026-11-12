/**
 * Soft-404 layout tests — the [slug]/layout.tsx existence checks.
 *
 * BACKGROUND (proven 2026-11-12, minimal Next 13.5.9 repro app):
 * a notFound() thrown by the page or generateMetadata does NOT
 * produce HTTP 404 when a loading.tsx wraps the route — the loading
 * shell streams first with status 200 and the inner NotFoundBoundary
 * swallows the error (the live site returned 200 for all three
 * unknown slugs with exactly that wiring). Removing loading.tsx
 * fixes the status (repro: 404) but loses the skeleton. The layout
 * check is the fix that keeps both: it runs BEFORE the loading
 * Suspense boundary, so its notFound() reaches Next's outer render
 * catch and returns a real 404 — while valid slugs still stream the
 * skeleton (repro: 200 + skeleton + product content).
 *
 * These tests cover the layouts' decision: unknown slug -> throws
 * the NEXT_NOT_FOUND error (what Next turns into a 404 response),
 * known slug -> renders children. The data layer is mocked; the
 * HTTP status itself is re-verified by the live recheck after push.
 * A structural pin also asserts the loading.tsx skeletons were NOT
 * deleted as part of this fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  productBySlug: vi.fn(),
  brandPageBySlug: vi.fn(),
  categoryPageBySlug: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    const error = new Error('NEXT_NOT_FOUND') as Error & {
      digest: string;
    };
    error.digest = 'NEXT_NOT_FOUND';
    throw error;
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({}),
}));

vi.mock('@/services/products', () => ({
  getCachedProductBySlug: (...args: unknown[]) =>
    mocks.productBySlug(...args),
}));

vi.mock('@/lib/brand-category-seo-server', () => ({
  getBrandPageData: (...args: unknown[]) => mocks.brandPageBySlug(...args),
  getCategoryPageData: (...args: unknown[]) =>
    mocks.categoryPageBySlug(...args),
}));

import ProductSlugLayout from '@/app/products/[slug]/layout';
import BrandSlugLayout from '@/app/brands/[slug]/layout';
import CategorySlugLayout from '@/app/categories/[slug]/layout';

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { digest?: unknown }).digest === 'NEXT_NOT_FOUND'
  );
}

describe('products [slug] layout: unknown slug throws NEXT_NOT_FOUND', () => {
  beforeEach(() => {
    mocks.productBySlug.mockReset();
  });

  it('throws for a slug with no product row', async () => {
    mocks.productBySlug.mockResolvedValue(null);
    let caught: unknown;
    try {
      await ProductSlugLayout({
        children: 'CHILD',
        params: { slug: 'does-not-exist-xyz' },
      });
    } catch (error) {
      caught = error;
    }
    expect(isNotFoundError(caught)).toBe(true);
  });

  it('renders children for a known slug', async () => {
    mocks.productBySlug.mockResolvedValue({ slug: 'macbook-air-13' });
    const result = await ProductSlugLayout({
      children: 'CHILD',
      params: { slug: 'macbook-air-13' },
    });
    // The products layout returns a JSX fragment (see its file
    // comment: bare ReactNode return trips TS1062), so children
    // arrive as the fragment's props.
    expect(result).toBeTruthy();
    expect(
      (result as { props?: { children?: unknown } }).props?.children,
    ).toBe('CHILD');
  });

  it('checks the slug through the cached lookup, not the heavy SEO fetch', () => {
    const source = readFileSync('app/products/[slug]/layout.tsx', 'utf8');
    expect(source).toContain('getCachedProductBySlug');
    expect(source).not.toContain('getProductSeo');
    expect(source).toContain('notFound()');
  });
});

describe('brands [slug] layout: unknown slug throws NEXT_NOT_FOUND', () => {
  beforeEach(() => {
    mocks.brandPageBySlug.mockReset();
  });

  it('throws for a slug matching no brand row and no product', async () => {
    mocks.brandPageBySlug.mockResolvedValue(null);
    let caught: unknown;
    try {
      await BrandSlugLayout({
        children: 'CHILD',
        params: { slug: 'does-not-exist-xyz' },
      });
    } catch (error) {
      caught = error;
    }
    expect(isNotFoundError(caught)).toBe(true);
  });

  it('renders children for a known brand slug', async () => {
    mocks.brandPageBySlug.mockResolvedValue({ slug: 'apple', products: [] });
    const result = await BrandSlugLayout({
      children: 'CHILD',
      params: { slug: 'apple' },
    });
    // The layout returns a JSX fragment (bare ReactNode return
    // trips TS1062 — see the layout file comment), so children
    // arrive as the fragment's props.
    expect(result).toBeTruthy();
    expect(
      (result as { props?: { children?: unknown } }).props?.children,
    ).toBe('CHILD');
  });
});

describe('categories [slug] layout: unknown slug throws NEXT_NOT_FOUND', () => {
  beforeEach(() => {
    mocks.categoryPageBySlug.mockReset();
  });

  it('throws for a slug matching no category row and no product', async () => {
    mocks.categoryPageBySlug.mockResolvedValue(null);
    let caught: unknown;
    try {
      await CategorySlugLayout({
        children: 'CHILD',
        params: { slug: 'does-not-exist-xyz' },
      });
    } catch (error) {
      caught = error;
    }
    expect(isNotFoundError(caught)).toBe(true);
  });

  it('renders children for a known category slug', async () => {
    mocks.categoryPageBySlug.mockResolvedValue({
      slug: 'laptops',
      products: [],
    });
    const result = await CategorySlugLayout({
      children: 'CHILD',
      params: { slug: 'laptops' },
    });
    // The layout returns a JSX fragment (bare ReactNode return
    // trips TS1062 — see the layout file comment), so children
    // arrive as the fragment's props.
    expect(result).toBeTruthy();
    expect(
      (result as { props?: { children?: unknown } }).props?.children,
    ).toBe('CHILD');
  });
});

describe('skeletons kept: the fix must not delete loading.tsx', () => {
  it('all three routes still have their loading shells', () => {
    for (const file of [
      'app/products/[slug]/loading.tsx',
      'app/brands/loading.tsx',
      'app/categories/loading.tsx',
    ]) {
      expect(() => readFileSync(file, 'utf8')).not.toThrow();
    }
  });

  it('all three layout files call notFound()', () => {
    for (const file of [
      'app/products/[slug]/layout.tsx',
      'app/brands/[slug]/layout.tsx',
      'app/categories/[slug]/layout.tsx',
    ]) {
      expect(readFileSync(file, 'utf8')).toContain('notFound()');
    }
  });
});
