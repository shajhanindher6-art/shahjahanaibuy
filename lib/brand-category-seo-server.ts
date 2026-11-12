/**
 * Server-only fetch for brand / category listing pages (Section 9,
 * chunk 2).
 *
 * Kept separate from lib/brand-category-seo.ts on purpose: this file
 * imports the Supabase server client (next/headers), which cannot run
 * in the plain-Node vitest environment — the pure builders stay
 * testable. Same split as lib/product-seo-server.ts.
 *
 * Data source is the same as the API routes: the `brands` /
 * `categories` reference tables (services/catalog.ts, used by
 * /api/v1/brands/[slug] and /api/v1/categories/[slug]) plus the
 * products table (services/products.ts). Returns null for an
 * unknown slug (the page then 404s) or on error; a reference row
 * with no products still returns page data with an empty products
 * array so the page renders the honest empty state.
 */

import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getBrandBySlug, getCategoryBySlug } from '@/services/catalog';
import { getProducts } from '@/services/products';
import {
  resolveTaxonomyPage,
  type TaxonomyPageData,
} from '@/lib/brand-category-seo';

/**
 * Server-side listing data for one brand slug.
 * Returns null when the slug matches no brand row and no product.
 *
 * React-cache() memoized per request: the [slug]/layout.tsx
 * existence check, generateMetadata and the page body all call this
 * with the same slug, and share one execution instead of tripling
 * the database work.
 */
export const getBrandPageData = cache(async function getBrandPageData(
  slug: string
): Promise<TaxonomyPageData | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const brand = await getBrandBySlug(supabase, slug);
    // Exact brand-name match first (indexed, cheap). If the
    // reference row exists but that query finds nothing — e.g. the
    // product text differs slightly from the reference name — fall
    // back to the full catalog so resolveTaxonomyPage can still
    // match by slug; it never invents a product.
    let products = brand
      ? (await getProducts(supabase, { brand: brand.name, pageSize: 100 }))
          .products
      : (await getProducts(supabase, { pageSize: 100 })).products;
    if (brand && products.length === 0) {
      products = (await getProducts(supabase, { pageSize: 100 })).products;
    }
    return resolveTaxonomyPage({
      kind: 'brand',
      slug,
      record: brand
        ? { name: brand.name, slug: brand.slug, description: brand.description }
        : null,
      products,
    });
  } catch {
    return null;
  }
});

/**
 * Server-side listing data for one category slug.
 * Returns null when the slug matches no category row and no product.
 *
 * React-cache() memoized per request — same reason as
 * getBrandPageData above: layout, metadata and page share one
 * execution per request.
 */
export const getCategoryPageData = cache(async function getCategoryPageData(
  slug: string
): Promise<TaxonomyPageData | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const category = await getCategoryBySlug(supabase, slug);
    let products = category
      ? (
          await getProducts(supabase, {
            category: category.name,
            pageSize: 100,
          })
        ).products
      : (await getProducts(supabase, { pageSize: 100 })).products;
    if (category && products.length === 0) {
      products = (await getProducts(supabase, { pageSize: 100 })).products;
    }
    return resolveTaxonomyPage({
      kind: 'category',
      slug,
      record: category
        ? {
            name: category.name,
            slug: category.slug,
            description: category.description,
          }
        : null,
      products,
    });
  } catch {
    return null;
  }
});
