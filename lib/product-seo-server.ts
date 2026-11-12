/**
 * Server-only fetch for product SEO facts (P0 fix, 2026-11-09 audit).
 *
 * Kept separate from lib/product-seo.ts on purpose: this file imports
 * the Supabase server client (next/headers), which cannot run in the
 * plain-Node vitest environment — the pure builders stay testable.
 *
 * No React cache() here: this repo runs React 18.2 (Next 13.5),
 * where `cache` from 'react' does not exist yet. generateMetadata
 * and the page each call getProductSeo once per request; the product
 * row itself is deduped by the service's own SWR cache
 * (getCachedProductBySlug, 60s fresh / 5min stale), and the merchant
 * + review queries are cheap indexed selects.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCachedProductBySlug } from '@/services/products';
import { getMerchantProducts } from '@/services/commerce';
import { getReviewSummary } from '@/services/reviews';
import { deriveOfferPriceValidUntil } from '@/lib/product-seo';
import type { ProductSeoData } from '@/lib/product-seo';

/**
 * Server-side SEO facts for one product slug.
 * Returns null for an unknown slug (the page then 404s) or on error.
 */
export async function getProductSeo(
  slug: string
): Promise<ProductSeoData | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const product = await getCachedProductBySlug(supabase, slug);
    if (!product) return null;

    // Cheapest first (the service orders by price ascending).
    const listings = await getMerchantProducts(supabase, product.id);
    const cheapest = listings[0] ?? null;
    const summary = await getReviewSummary(supabase, product.id);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      category: product.category,
      imageUrl: product.imageUrl,
      gtin: product.gtin,
      confidenceScore: product.confidenceScore,
      lowestPrice: cheapest ? cheapest.price : null,
      // Section 15 P1-11: the recorded freshness timestamp travels
      // with the SEO facts so the page can render "Prices last
      // checked" server-side — no extra query, no client fetch.
      dataFreshness: product.dataFreshness ?? null,
      // Section 16, item 12: validity derived from the recorded
      // freshness + the 7-day stale threshold (null when the price
      // is already stale or no freshness is recorded — the offers
      // block is then suppressed or dateless, never backdated).
      priceValidUntil: deriveOfferPriceValidUntil(product.dataFreshness ?? null),
      inStock:
        listings.length === 0
          ? null
          : listings.some(
              (l) => l.inStock || l.availability === 'in_stock'
            ),
      averageRating: summary.averageRating,
      reviewCount: summary.totalReviews,
    };
  } catch {
    return null;
  }
}
