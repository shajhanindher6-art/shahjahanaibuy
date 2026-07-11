/**
 * AI product comparison service.
 * Compares products across retailers and generates AI summaries.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { swrGet, cacheKey } from '@/lib/cache';
import type { ProductComparison, ComparisonProduct } from '@/types/ai';
import type { Product } from '@/types';

export async function compareProducts(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<ProductComparison | null> {
  if (productIds.length < 2 || productIds.length > 5) return null;

  try {
    const { data: productsData, error: productsError } = await supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
      .in('id', productIds)
      .is('deleted_at', null);

    if (productsError || !productsData || productsData.length < 2) {
      if (productsError) logger.warn('compareProducts: products query failed', { error: productsError.message });
      return null;
    }

    const products: ComparisonProduct[] = [];

    for (const pRow of productsData) {
      const product = pRow as Record<string, unknown>;
      const productId = product.id as string;

      const { data: pricesData } = await supabase
        .from('price_history')
        .select('id, product_id, retailer_id, price, currency, availability, url, recorded_at')
        .eq('product_id', productId)
        .order('recorded_at', { ascending: false })
        .limit(10);

      const { data: retailersData } = await supabase
        .from('retailers')
        .select('id, name, slug, logo_url, website_url, active, country, created_at, updated_at')
        .eq('active', true);

      const retailerMap = new Map<string, string>();
      for (const r of retailersData ?? []) {
        const rRow = r as Record<string, unknown>;
        retailerMap.set(rRow.id as string, rRow.name as string);
      }

      const { data: reviewsData } = await supabase
        .from('reviews')
        .select('rating')
        .eq('product_id', productId)
        .is('deleted_at', null)
        .limit(1000);

      const ratings = (reviewsData ?? []).map((r) => (r as Record<string, unknown>).rating as number);
      const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

      const seenRetailers = new Set<string>();
      const retailerEntries: ComparisonProduct['retailers'] = [];

      for (const pHist of pricesData ?? []) {
        const phRow = pHist as Record<string, unknown>;
        const retailerId = phRow.retailer_id as string;
        if (seenRetailers.has(retailerId)) continue;
        seenRetailers.add(retailerId);

        retailerEntries.push({
          retailerName: retailerMap.get(retailerId) ?? 'Unknown',
          price: parseFloat(String(phRow.price)),
          originalPrice: null,
          discount: null,
          rating: avgRating,
          reviewCount: ratings.length,
          shipping: null,
          availability: phRow.availability as string,
          seller: null,
          warranty: null,
          url: phRow.url as string | null,
        });
      }

      products.push({
        productId,
        name: product.name as string,
        brand: product.brand as string | null,
        image: product.image_url as string | null,
        retailers: retailerEntries,
      });
    }

    const aiSummary = generateComparisonSummary(products);
    const bestChoice = determineBestChoice(products);

    return {
      id: '',
      products,
      aiSummary,
      bestChoice,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('compareProducts: unexpected error', { error: String(err) });
    return null;
  }
}

function generateComparisonSummary(products: ComparisonProduct[]): string {
  if (products.length < 2) return 'Not enough products to compare.';

  const lines: string[] = [];

  const allPrices = products.flatMap((p) => p.retailers.map((r) => r.price));
  const cheapest = Math.min(...allPrices);
  const cheapestProduct = products.find((p) => p.retailers.some((r) => r.price === cheapest));

  lines.push(`Based on the comparison of ${products.length} products:`);

  if (cheapestProduct) {
    lines.push(`The ${cheapestProduct.name} offers the best price at $${cheapest.toFixed(2)}.`);
  }

  const bestRated = products
    .map((p) => ({
      product: p,
      avgRating: p.retailers.length > 0 && p.retailers[0].rating
        ? p.retailers[0].rating
        : 0,
    }))
    .sort((a, b) => b.avgRating - a.avgRating)[0];

  if (bestRated && bestRated.avgRating > 0) {
    lines.push(`The ${bestRated.product.name} has the highest rating at ${bestRated.avgRating.toFixed(1)} stars.`);
  }

  const mostAvailable = products
    .map((p) => ({ product: p, availableCount: p.retailers.filter((r) => r.availability === 'in_stock').length }))
    .sort((a, b) => b.availableCount - a.availableCount)[0];

  if (mostAvailable && mostAvailable.availableCount > 0) {
    lines.push(`The ${mostAvailable.product.name} is available from the most retailers (${mostAvailable.availableCount}).`);
  }

  lines.push('Consider your priorities: budget, quality, or availability when making your choice.');

  return lines.join(' ');
}

function determineBestChoice(products: ComparisonProduct[]): string | null {
  if (products.length < 2) return null;

  let best = products[0];
  let bestScore = -Infinity;

  for (const p of products) {
    const prices = p.retailers.map((r) => r.price);
    const minPrice = prices.length > 0 ? Math.min(...prices) : Infinity;
    const avgRating = p.retailers.length > 0 && p.retailers[0].rating ? p.retailers[0].rating : 0;
    const availability = p.retailers.filter((r) => r.availability === 'in_stock').length;

    const score = (1 / (minPrice / 100)) * 30 + avgRating * 10 + availability * 5;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best.productId;
}

export async function getCachedComparison(
  supabase: AnySupabaseClient,
  productIds: string[]
): Promise<ProductComparison | null> {
  const sortedIds = [...productIds].sort().join(':');
  const key = cacheKey('comparison', sortedIds);
  return swrGet<ProductComparison | null>(
    key,
    () => compareProducts(supabase, productIds),
    60_000,
    300_000
  );
}
