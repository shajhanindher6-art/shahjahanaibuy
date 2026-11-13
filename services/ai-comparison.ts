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
import { getProductRecordedOverrides } from '@/services/recorded-overrides';
import { getProductGlobalReadiness } from '@/services/global-readiness';
import { predictPriceDrop } from '@/services/ai-predictions';
import { dealScoreForDisplay } from '@/lib/deal-score';
// Section 19, Phase 5 — warranty (#49) + merchant reliability
// (#50) from recorded merchant policy data; suitability prose
// (#51); source labelling (#55).
import { getMerchantPolicy } from '@/lib/merchant-trust';
import {
  formatWarranty,
  getMerchantReliability,
  type MerchantReliability,
} from '@/services/merchant-reliability';
import { buildSuitabilityExplanations } from '@/services/comparison-suitability';
import {
  appendSourceLabel,
  GENERAL_GUIDANCE_LABEL,
  verifiedDataRangeLabel,
} from '@/lib/ai-source-label';

/**
 * Format a recorded shipping offer into display text, or null when
 * nothing is recorded (Section 19, Phase 5, §12 #57). Reads ONLY
 * `merchant_products.shipping_cost` / `shipping_days` — a missing
 * value is never filled in with a guessed cost or delivery time.
 * "Free shipping" is the recorded $0 cost, not an assumption.
 */
export function formatShipping(
  shippingCost: number | string | null | undefined,
  shippingDays: number | string | null | undefined
): string | null {
  const cost =
    shippingCost === null || shippingCost === undefined ? null : Number(shippingCost);
  const days =
    shippingDays === null || shippingDays === undefined ? null : Number(shippingDays);
  const hasCost = cost !== null && Number.isFinite(cost);
  const hasDays = days !== null && Number.isFinite(days);
  if (!hasCost && !hasDays) return null;
  if (!hasCost) {
    return `${days} day${days === 1 ? '' : 's'} delivery (shipping cost not recorded)`;
  }
  const costText = cost === 0 ? 'Free shipping' : `$${cost.toFixed(2)} shipping`;
  return hasDays ? `${costText} · ${days} day${days === 1 ? '' : 's'}` : costText;
}

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
      .select('id, name, website_url, active')
      .eq('active', true)
      .is('deleted_at', null);

    const merchantNameMap = new Map<string, string>();
    // Section 19, Phase 5 (§12 #50): directory facts for the
    // reliability scorer — website + active status, recorded only.
    const merchantInfoMap = new Map<
      string,
      { name: string; websiteUrl: string | null; active: boolean }
    >();
    for (const m of merchantsData ?? []) {
      const mRow = m as Record<string, unknown>;
      merchantNameMap.set(mRow.id as string, mRow.name as string);
      merchantInfoMap.set(mRow.id as string, {
        name: mRow.name as string,
        websiteUrl: (mRow.website_url as string | null) ?? null,
        active: mRow.active !== false,
      });
    }

    // Section 19, Phase 5 (§12 #49/#50): per-merchant recorded
    // policy (warranty) + reliability, fetched ONCE per merchant
    // across all compared products — never per row, never invented.
    // A merchant with no recorded policy gets a null warranty and a
    // not-enough-data reliability (the UI renders honest empty
    // states for both).
    const warrantyByMerchant = new Map<string, string | null>();
    const reliabilityByMerchant = new Map<string, MerchantReliability | null>();
    async function merchantFacts(merchantId: string): Promise<{
      warranty: string | null;
      reliability: MerchantReliability | null;
    }> {
      if (!warrantyByMerchant.has(merchantId) || !reliabilityByMerchant.has(merchantId)) {
        const info = merchantInfoMap.get(merchantId);
        const policy = await getMerchantPolicy(supabase, merchantId);
        warrantyByMerchant.set(merchantId, formatWarranty(policy.warrantyMonths));
        reliabilityByMerchant.set(
          merchantId,
          info
            ? await getMerchantReliability(
                supabase,
                { id: merchantId, name: info.name, websiteUrl: info.websiteUrl, active: info.active },
                policy
              )
            : null
        );
      }
      return {
        warranty: warrantyByMerchant.get(merchantId) ?? null,
        reliability: reliabilityByMerchant.get(merchantId) ?? null,
      };
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
        .select('merchant_id, price, compare_at_price, availability, url, in_stock, shipping_cost, shipping_days')
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
        const merchantName = merchantNameMap.get(merchantId) ?? 'Retailer';
        // Section 19, Phase 5 (§12 #49/#57): shipping from the
        // recorded shipping_cost/shipping_days (null → honest empty
        // state in the UI, never a guessed cost); the seller of
        // record for a merchant_products listing IS the merchant —
        // no separate marketplace seller name is recorded in the
        // schema, so the merchant name is the seller, not an
        // invention. Warranty + reliability come from the recorded
        // merchant policy (028 columns, all null live → empty state).
        const facts = await merchantFacts(merchantId);

        retailerEntries.push({
          retailerName: merchantName,
          price,
          originalPrice: compareAt,
          discount:
            compareAt !== null && compareAt > price
              ? Math.round((1 - price / compareAt) * 100)
              : null,
          rating: avgRating,
          reviewCount: ratings.length,
          shipping: formatShipping(
            mpRow.shipping_cost as number | null,
            mpRow.shipping_days as number | null
          ),
          availability: inStock ? 'in_stock' : 'out_of_stock',
          seller: merchantName,
          warranty: facts.warranty,
          url: mpRow.url as string | null,
          reliability: facts.reliability,
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
            // Section 19, Phase 5 (§12 #57): the price_history
            // fallback carries no shipping columns — the honest cell
            // is the empty state, never a guessed cost. The seller
            // of record is the retailer itself (same rule as the
            // merchant_products path). Warranty + reliability need a
            // merchant id, which price_history rows don't carry, so
            // both stay null (empty state) on this path.
            shipping: null,
            availability: phRow.availability as string,
            seller: retailerMap.get(retailerId) ?? 'Unknown',
            warranty: null,
            url: phRow.url as string | null,
            reliability: null,
          });
        }
      }

      // Option 16/17: repairability + endurance are separate fail-safe
      // reads per product — nulls when migrations 019/020 have not
      // been run yet, so the comparison never breaks on a missing column.
      // Option 18: physical attributes are the same pattern (021).
      // Option 19: recorded overrides are the same pattern (022).
      // Option 20: global readiness is the same pattern (023).
      const repairability = await getProductRepairability(supabase, productId);
      const endurance = await getProductEndurance(supabase, productId);
      const physical = await getProductPhysical(supabase, productId);
      const recorded = await getProductRecordedOverrides(supabase, productId);
      const globalReadiness = await getProductGlobalReadiness(supabase, productId);

      // S2#10: canonical Deal Score from the same price-drop
      // prediction the product page renders (lib/deal-score.ts) —
      // null when the product has no usable prediction or too few
      // price points (Section 15, B1: hidden below 5 points), so
      // the compare table says "Not enough history" instead of a
      // synthesized score. predictPriceDrop is cached (swrGet) and
      // fail-safe (null on no price history), so a product without
      // history never breaks the comparison.
      const prediction = await predictPriceDrop(supabase, productId);
      const dealScore = dealScoreForDisplay(prediction);

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
        recorded,
        globalReadiness,
        dealScore,
        // Section 16, items 9–10: recorded freshness for the stale
        // badge, point count for the withheld-score note.
        dataFreshness: (product.data_freshness as string | null) ?? null,
        dealScoreDataPoints:
          prediction && typeof prediction.dataPoints === 'number'
            ? prediction.dataPoints
            : null,
      });
    }

    const aiSummary = generateComparisonSummary(products);
    const bestChoice = determineBestChoice(products);
    // Section 19, Phase 5 (§12 #51/#55): per-requirement suitability
    // prose grounded in the real rows, and the source label for the
    // verdict — verified recorded data with the products' freshness
    // range, plus the note that the summary's closing
    // "consider your priorities" line is general guidance, not
    // verified data. The label is appended to aiSummary too, so API
    // consumers who only read the summary still see it.
    const suitability = buildSuitabilityExplanations(products);
    const sourceLabel =
      `${verifiedDataRangeLabel(products.map((p) => p.dataFreshness ?? null))} ` +
      `The closing recommendation in this summary is ${GENERAL_GUIDANCE_LABEL}.`;

    return {
      id: '',
      products,
      aiSummary: appendSourceLabel(aiSummary, sourceLabel),
      bestChoice,
      suitability,
      sourceLabel,
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
