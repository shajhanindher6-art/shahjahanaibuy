/**
 * API v1 similar products endpoint.
 * GET /api/v1/products/[slug]/similar — fetch products in the same category/brand.
 *
 * Each card carries its lowest in-stock merchant price (`price`) and
 * the number of merchants with it in stock (`merchantCount`) — real
 * merchant_products rows, so ProductCard can show a price instead of
 * a priceless card. A similar product with no in-stock listing has
 * `price: null` and shows no price, never a guessed one.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProductBySlug, getLowestMerchantPrices, type LowestMerchantPrice } from '@/services/products';
import { rankSimilarByValue, similarityScore } from '@/lib/similar-value';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'products.similar', slug: params.slug });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`products.slug.similar:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(20, Math.max(1, Number(searchParams.get('limit') ?? 4)));

    const supabase = await createSupabaseServerClient();
    const product = await getProductBySlug(supabase, params.slug);

    if (!product) {
      return notFound('Product not found');
    }

    // Section 19, Phase 4 (§12 #47) — fetch a wider pool than the
    // requested limit (up to 3x, capped at 20) so value ranking can
    // surface a cheaper / bigger-saving alternative that confidence
    // order alone would have cut off; the final slice below restores
    // the requested limit.
    const fetchLimit = Math.min(20, limit * 3);

    let query = supabase
      .from('products')
      .select('id, name, slug, description, brand, category, image_url, confidence_score, data_freshness')
      .neq('id', product.id)
      // The 'sample-laptop' health-check row is not a real product
      // and must never surface as a "similar product" (Section 14,
      // chunk 5 leak check — getProducts already excludes it, but
      // this route queries the table directly).
      .neq('slug', 'sample-laptop')
      .is('deleted_at', null)
      .order('confidence_score', { ascending: false })
      .limit(fetchLimit);

    const orConditions: string[] = [];
    if (product.category) orConditions.push(`category.ilike.%${product.category}%`);
    if (product.brand) orConditions.push(`brand.ilike.%${product.brand}%`);

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error || !data) {
      return internalError('Failed to fetch similar products');
    }

    // Lowest in-stock merchant price + in-stock merchant count per
    // similar product (one batched query). A failure here degrades
    // to priceless cards, never a guessed price. The anchor's own
    // lowest price rides in the same batch — it is the reference
    // for the similarity score below, not a displayed price.
    let lowest = new Map<string, LowestMerchantPrice>();
    try {
      lowest = await getLowestMerchantPrices(supabase, [
        ...(data ?? []).map((row) => row.id as string),
        product.id as string,
      ]);
    } catch {
      lowest = new Map();
    }
    const anchorPrice = lowest.get(product.id as string)?.price ?? null;

    const results = rankSimilarByValue(
      (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        brand: row.brand,
        category: row.category,
        imageUrl: row.image_url,
        description: row.description,
        price: lowest.get(row.id)?.price ?? null,
        merchantCount: lowest.get(row.id)?.merchantCount ?? 0,
        // Section 16, item 9: recorded freshness rides with the card
        // so the stale-price badge + age can render under the price.
        dataFreshness: (row.data_freshness as string | null) ?? null,
        // Sections 21–25, Stage H (H-P2-7) — a REAL similarity
        // score (same brand +40, same category +30, price within
        // 20% +30; see lib/similar-value.ts). The old value was
        // confidence_score — a field-presence completeness count
        // presented as a match. No randomness, no invented data.
        matchScore: similarityScore({
          anchorBrand: product.brand,
          anchorCategory: product.category,
          anchorPrice,
          brand: row.brand,
          category: row.category,
          price: lowest.get(row.id)?.price ?? null,
        }),
        reason: product.brand && row.brand === product.brand
          ? `Same brand as ${product.name}`
          : `Similar ${product.category ?? 'product'} category`,
        // Section 19, Phase 4 (§12 #47) — the value rank inputs:
        // the merchant-basis saving % behind the lowest price
        // (null when no compare-at price exists — never 0% pretending
        // to be measured). rankSimilarByValue orders by saving %,
        // then lowest price, then match score, so better-value
        // alternatives surface first instead of just the closest
        // confidence match.
        savingPct: lowest.get(row.id)?.discountPercent ?? null,
      }))
    ).slice(0, limit);

    return apiSuccess(results, 200, { total: results.length });
  } catch (err) {
    logApiError(err, { request, route: 'products.similar', status: 500 });
    return internalError('Failed to fetch similar products');
  }
}
