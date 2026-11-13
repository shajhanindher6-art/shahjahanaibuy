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
 * (getCachedProductBySlug, 60s fresh / 5min stale), and — since
 * Section 18, item 26 — so are the merchant listings
 * (getCachedMerchantProducts) and the review summary
 * (getCachedReviewSummary): the second call serves the first
 * call's cached results instead of re-querying.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCachedProductBySlug } from '@/services/products';
import { getProductImagesWithVerification } from '@/services/product-images';
import { getCachedMerchantProducts } from '@/services/commerce';
import { getCachedReviewSummary } from '@/services/reviews';
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
    // Cached (Section 18, item 26): generateMetadata and the page
    // body each call getProductSeo per request — the second call
    // hits these SWR caches instead of re-querying.
    const listings = await getCachedMerchantProducts(supabase, product.id);
    const cheapest = listings[0] ?? null;
    const summary = await getCachedReviewSummary(supabase, product.id);

    // FINAL 100%, F-P2-33 — the primary gallery image's
    // verification verdict (migration 069; null when unknown or
    // when there are no gallery rows). A known-broken image must
    // never become the og:image; an unchecked hotlink keeps the
    // previous behaviour.
    let imageVerificationStatus: ProductSeoData['imageVerificationStatus'] = null;
    try {
      const gallery = await getProductImagesWithVerification(supabase, product.id);
      const primary = gallery.images.find((img) => img.isPrimary) ?? gallery.images[0];
      imageVerificationStatus = primary?.verificationStatus ?? null;
    } catch {
      imageVerificationStatus = null;
    }

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      brand: product.brand,
      category: product.category,
      imageUrl: product.imageUrl,
      imageVerificationStatus,
      gtin: product.gtin,
      confidenceScore: product.confidenceScore,
      lowestPrice: cheapest ? cheapest.price : null,
      // Section 17, Stage C item 14: verification of the shown
      // lowest price — the cheapest listing's own status when a
      // listing exists (it is the price the page shows), else the
      // product-level rollup. Pre-migration both read 'unverified'.
      priceVerificationStatus:
        cheapest?.priceVerificationStatus ?? product.priceVerificationStatus ?? 'unverified',
      priceVerifiedAt: cheapest?.priceVerifiedAt ?? product.priceVerifiedAt ?? null,
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
