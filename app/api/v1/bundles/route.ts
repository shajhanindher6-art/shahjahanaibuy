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
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getProducts } from '@/services/products';
import { getMerchantProducts } from '@/services/commerce';
import {
  allocateBundle,
  type BundleCandidate,
} from '@/services/bundle-allocator';

// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'bundles' });

  try {
    const { searchParams } = request.nextUrl;
    const budgetRaw = searchParams.get('budget');
    const categoriesRaw = searchParams.get('categories');

    const supabase = await createSupabaseServerClient();
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
  } catch {
    return internalError('Failed to build a bundle');
  }
}
