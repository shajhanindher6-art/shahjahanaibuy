/**
 * API v1 bundles endpoint — Enterprise feature #4 (Budget-to-Cart).
 *
 * GET /api/v1/bundles — without params, returns the catalog's real
 * categories so the picker can offer only categories that exist.
 * GET /api/v1/bundles?budget=1500&categories=Laptops,Phones —
 * runs the deterministic allocator (services/bundle-allocator.ts)
 * over the REAL catalog with each product's recorded lowest
 * merchant price. Sample Laptop and unpriced products are never
 * returned; the total never exceeds the budget; no price is invented.
 * GET /api/v1/bundles?comboFor=<slug> — combo bundle (Section 3,
 * item 5): the anchor product plus its best-graded compatible
 * catalogue products (services/compatibility.ts), priced from real
 * recorded merchant listings. The bundle total is the sum of those
 * real prices; savings come only from recorded compare-at prices.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProducts, getProductBySlug } from '@/services/products';
import { getMerchantProducts } from '@/services/commerce';
import { gradeCompatibility } from '@/services/compatibility';
import { suggestCombo, type BundleItemInput } from '@/lib/bundles';
import {
  allocateBundle,
  type BundleCandidate,
} from '@/services/bundle-allocator';

import { logApiError } from '@/lib/api/error-logging';
// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'bundles' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`bundles:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const comboFor = searchParams.get('comboFor');
    const budgetRaw = searchParams.get('budget');
    const categoriesRaw = searchParams.get('categories');

    const supabase = await createSupabaseServerClient();

    // --- Combo bundles (Section 3, item 5) -------------------------
    // GET /api/v1/bundles?comboFor=<slug> — the anchor product plus
    // its best-graded compatible catalogue products, priced from
    // real recorded merchant listings. The bundle total is the sum
    // of those real prices; savings come only from recorded
    // compare-at prices. Unpriced candidates are never suggested.
    if (comboFor !== null) {
      const anchor = await getProductBySlug(supabase, comboFor.trim());
      if (!anchor) return badRequest('Unknown product slug.');
      if (anchor.slug === 'sample-laptop') {
        return badRequest('Sample Laptop is a health-check row, not a real product.');
      }

      const { products } = await getProducts(supabase, { pageSize: 100 });
      const candidates: BundleItemInput[] = [];
      for (const product of products) {
        if (product.slug === anchor.slug) continue;
        const listings = await getMerchantProducts(supabase, product.id);
        const lowest = listings.length > 0 ? listings[0].price : null;
        const compareAt =
          listings.length > 0 && typeof listings[0].compareAtPrice === 'number'
            ? listings[0].compareAtPrice
            : null;
        const graded = gradeCompatibility(
          { brand: anchor.brand, category: anchor.category },
          {
            slug: product.slug,
            name: product.name,
            brand: product.brand ?? null,
            category: product.category ?? null,
            priceUsd: lowest,
          }
        );
        candidates.push({
          slug: product.slug,
          name: product.name,
          brand: product.brand ?? null,
          category: product.category ?? null,
          lowestPriceUsd: lowest,
          compareAtPriceUsd: compareAt,
          grade: graded.grade,
          gradeNote: graded.gradeNote,
        });
      }

      const anchorListings = await getMerchantProducts(supabase, anchor.id);
      const anchorPrice = anchorListings.length > 0 ? anchorListings[0].price : null;
      const anchorCompareAt =
        anchorListings.length > 0 && typeof anchorListings[0].compareAtPrice === 'number'
          ? anchorListings[0].compareAtPrice
          : null;
      const combo = suggestCombo(
        {
          slug: anchor.slug,
          name: anchor.name,
          brand: anchor.brand ?? null,
          category: anchor.category ?? null,
          lowestPriceUsd: anchorPrice,
          compareAtPriceUsd: anchorCompareAt,
        },
        candidates,
        3
      );

      if (!combo) {
        return apiSuccess({
          anchor: { slug: anchor.slug, name: anchor.name },
          combo: null,
          message:
            'No priced compatible products found in the catalogue for this product yet.',
        });
      }
      return apiSuccess({
        anchor: { slug: anchor.slug, name: anchor.name },
        combo: {
          items: combo.items,
          totals: combo.totals,
        },
      });
    }

    const { products } = await getProducts(supabase, { pageSize: 100 });

    const availableCategories = [...new Set(
      products
        .map((p) => (p.category ?? '').trim())
        .filter((c) => c !== '')
    )].sort((a, b) => a.localeCompare(b));

    // No budget → category discovery only (the picker needs it
    // before the user chooses anything).
    if (budgetRaw === null || categoriesRaw === null) {
      return apiSuccess({ availableCategories, productCount: products.length });
    }

    const budgetUsd = Number(budgetRaw);
    if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
      return badRequest('Budget must be a positive number of US dollars.');
    }
    const categories = categoriesRaw
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c !== '');
    if (categories.length === 0) {
      return badRequest('Choose at least one category.');
    }

    // Lowest recorded merchant price per product (merchant rows come
    // back price-ascending, so the first row is the lowest).
    const candidates: BundleCandidate[] = [];
    for (const product of products) {
      const listings = await getMerchantProducts(supabase, product.id);
      const lowest = listings.length > 0 ? listings[0].price : null;
      candidates.push({
        id: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand ?? null,
        category: product.category ?? null,
        lowestPriceUsd:
          lowest !== null && Number.isFinite(lowest) && lowest > 0 ? lowest : null,
      });
    }

    const result = allocateBundle({ budgetUsd, categories, products: candidates });

    return apiSuccess({
      ...result,
      availableCategories,
    });
  } catch (err) {
    logApiError(err, { request, route: 'bundles', status: 500 });
    return internalError('Failed to build a bundle');
  }
}
