/**
 * AI product comparison service.
 * Compares products across retailers and generates AI summaries.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { swrGet, cacheKey } from '@/lib/cache';
import type { ProductComparison, ComparisonProduct } from '@/types/ai';
import type { Product } from '@/types';
import { getProductRepairability } from '@/services/repairability';
import { getProductEndurance } from '@/services/hardware-endurance';
import { getProductPhysical } from '@/services/physical-attributes';

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

    // Merchant names, fetched once: the compare table must count the
    // SAME retailers as the product page's Where to Buy section, which
    // reads merchant_products joined to merchants — NOT price_history.
    // The old code derived retailers from price_history rows, whose
    // seed rows only ever carried a single retailer per product, so
    // the compare count was 1 while Where to Buy showed 2 (Amazon +
    // Best Buy). See getMerchantProducts in services/commerce.ts and
    // the merchants API route for the reference behavior.
    const { data: merchantsData } = await supabase
      .from('merchants')
      .select('id, name')
      .eq('active', true)
      .is('deleted_at', null);

    const merchantNameMap = new Map<string, string>();
    for (const m of merchantsData ?? []) {
      const mRow = m as Record<string, unknown>;
      merchantNameMap.set(mRow.id as string, mRow.name as string);
    }

    const products: ComparisonProduct[] = [];

    for (const pRow of productsData) {
      const product = pRow as Record<string, unknown>;
      const productId = product.id as string;

      const { data: reviewsData } = await supabase
        .from('reviews')
        .select('rating')
        .eq('product_id', productId)
        .is('deleted_at', null)
        .limit(1000);

      const ratings = (reviewsData ?? []).map((r) => (r as Record<string, unknown>).rating as number);
      const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

      // Primary source: merchant_products, exactly like Where to Buy
      // (cheapest first; one entry per merchant). This is what makes
      // the compare count match Where to Buy.
      const { data: listingsData } = await supabase
        .from('merchant_products')
        .select('merchant_id, price, compare_at_price, availability, url, in_stock')
        .eq('product_id', productId)
        .is('deleted_at', null)
        .order('price', { ascending: true });

      const seenMerchants = new Set<string>();
      const retailerEntries: ComparisonProduct['retailers'] = [];

      for (const row of listingsData ?? []) {
        const mpRow = row as Record<string, unknown>;
        const merchantId = mpRow.merchant_id as string;
        if (seenMerchants.has(merchantId)) continue;
        seenMerchants.add(merchantId);

        const price = parseFloat(String(mpRow.price));
        const compareAt =
          mpRow.compare_at_price !== null && mpRow.compare_at_price !== undefined
            ? parseFloat(String(mpRow.compare_at_price))
            : null;
        // Mirror the product page's in-stock rule: the boolean wins,
        // otherwise the availability string decides.
        const inStock = mpRow.in_stock === true || mpRow.availability === 'in_stock';

        retailerEntries.push({
          retailerName: merchantNameMap.get(merchantId) ?? 'Retailer',
          price,
          originalPrice: compareAt,
          discount:
            compareAt !== null && compareAt > price
              ? Math.round((1 - price / compareAt) * 100)
              : null,
          rating: avgRating,
          reviewCount: ratings.length,
          shipping: null,
          availability: inStock ? 'in_stock' : 'out_of_stock',
          seller: null,
          warranty: null,
          url: mpRow.url as string | null,
        });
      }

      // Fallback only: if a product has no merchant_products rows at
      // all, keep the old price_history-derived entries so the
      // comparison never goes empty for that product.
      if (retailerEntries.length === 0) {
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

        const seenRetailers = new Set<string>();
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
      }

      // Option 16/17: repairability + endurance are separate fail-safe
      // reads per product — nulls when migrations 019/020 have not
      // been run yet, so the comparison never breaks on a missing column.
      // Option 18: physical attributes are the same pattern (021).
      const repairability = await getProductRepairability(supabase, productId);
      const endurance = await getProductEndurance(supabase, productId);
      const physical = await getProductPhysical(supabase, productId);

      products.push({
        productId,
        slug: product.slug as string,
        name: product.name as string,
        brand: product.brand as string | null,
        image: product.image_url as string | null,
        category: product.category as string | null,
        retailers: retailerEntries,
        repairability,
        endurance,
        physical,
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

  // (7) Availability ties must never read as a false lead: the old
  // code sorted by count and named only the first product, so with
  // MacBook at 2 retailers and Sony also at 2 it still claimed
  // MacBook was "available from the most retailers". A tie now names
  // every tied product.
  const availabilityCounts = products.map((p) => ({
    product: p,
    availableCount: p.retailers.filter((r) => r.availability === 'in_stock').length,
  }));
  const maxAvailable = Math.max(0, ...availabilityCounts.map((c) => c.availableCount));
  const availabilityLeaders = availabilityCounts.filter((c) => c.availableCount === maxAvailable);
  if (maxAvailable > 0 && availabilityLeaders.length === 1) {
    lines.push(`The ${availabilityLeaders[0].product.name} is available from the most retailers (${maxAvailable}).`);
  } else if (maxAvailable > 0) {
    const names = availabilityLeaders.map((c) => c.product.name);
    const joined =
      names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    lines.push(`${joined} are tied for widest availability (${maxAvailable} retailers each).`);
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
