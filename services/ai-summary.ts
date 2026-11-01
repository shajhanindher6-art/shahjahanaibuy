/**
 * AI product summary service.
 * Generates and caches AI summaries with pros, cons, and alternatives.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { swrGet, cacheKey } from '@/lib/cache';
import type { AISummary } from '@/types/ai';
import type { Product } from '@/types';

export async function getAISummary(
  supabase: AnySupabaseClient,
  product: Product
): Promise<AISummary | null> {
  try {
    const cached = await getCachedSummary(supabase, product.id);
    if (cached) return cached;

    const [reviews, attributes, variants, priceHistory] = await Promise.all([
      getReviewsData(supabase, product.id),
      getAttributesData(supabase, product.id),
      getVariantsData(supabase, product.id),
      getPriceStats(supabase, product.id),
    ]);

    const summary = generateSummary(product, reviews, attributes, variants, priceHistory);
    const pros = generatePros(product, reviews, attributes, priceHistory);
    const cons = generateCons(product, reviews, priceHistory);
    const alternatives = await findAlternatives(supabase, product);

    const result: AISummary = {
      id: '',
      productId: product.id,
      summary,
      pros,
      cons,
      alternatives: alternatives.map((p) => p.slug),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };

    void storeSummary(supabase, result);

    return result;
  } catch (err) {
    logger.error('getAISummary: unexpected error', { error: String(err) });
    return null;
  }
}

function generateSummary(
  product: Product,
  reviews: { avgRating: number; count: number },
  attributes: Array<{ key: string; value: string }>,
  variants: number,
  priceStats: { lowest: number | null; highest: number | null; current: number | null }
): string {
  const parts: string[] = [];

  parts.push(`The ${product.name} is a ${product.category ?? 'product'} from ${product.brand ?? 'a reputable brand'}.`);

  if (reviews.count > 0) {
    parts.push(`It has an average rating of ${reviews.avgRating.toFixed(1)} stars from ${reviews.count} reviews, indicating ${reviews.avgRating >= 4 ? 'strong customer satisfaction' : 'mixed customer feedback'}.`);
  }

  if (attributes.length > 0) {
    const keySpecs = attributes.slice(0, 3).map((a) => `${a.key}: ${a.value}`).join(', ');
    parts.push(`Key specifications include ${keySpecs}.`);
  }

  if (variants > 1) {
    parts.push(`Available in ${variants} variants.`);
  }

  if (priceStats.current && priceStats.lowest) {
    if (priceStats.current <= priceStats.lowest * 1.05) {
      parts.push('The current price is near its historical low, making it a good time to buy.');
    } else if (priceStats.highest && priceStats.current >= priceStats.highest * 0.9) {
      parts.push('The current price is near its historical high — you may want to wait for a discount.');
    }
  }

  return parts.join(' ');
}

function generatePros(
  product: Product,
  reviews: { avgRating: number; count: number },
  attributes: Array<{ key: string; value: string }>,
  priceStats: { lowest: number | null; current: number | null }
): string[] {
  const pros: string[] = [];

  if (reviews.avgRating >= 4) pros.push(`High customer satisfaction (${reviews.avgRating.toFixed(1)} stars)`);
  if (reviews.count >= 50) pros.push(`Well-reviewed by ${reviews.count} customers`);
  if (product.brand) pros.push(`From established brand: ${product.brand}`);

  for (const attr of attributes.slice(0, 5)) {
    pros.push(`${attr.key}: ${attr.value}`);
  }

  if (priceStats.current && priceStats.lowest && priceStats.current <= priceStats.lowest * 1.05) {
    pros.push('Currently near its lowest recorded price');
  }

  if (pros.length === 0) pros.push('Product meets quality standards');

  return pros.slice(0, 6);
}

function generateCons(
  product: Product,
  reviews: { avgRating: number; count: number },
  priceStats: { lowest: number | null; highest: number | null; current: number | null }
): string[] {
  const cons: string[] = [];

  if (reviews.avgRating > 0 && reviews.avgRating < 4) cons.push(`Below-average rating (${reviews.avgRating.toFixed(1)} stars)`);
  if (reviews.count < 10 && reviews.count > 0) cons.push('Limited customer reviews available');
  // Mutually exclusive with the "near its lowest" pro above. The old
  // thresholds overlapped whenever the price range was narrow
  // (e.g. $999–$1048: 999 is both <= 999*1.1 and >= 1048*0.85), so the
  // live page showed BOTH "near its lowest" and "near its historical
  // high" at once. A price only counts as "near its high" when it is
  // within 5% of the high AND clearly above the low.
  if (
    priceStats.current &&
    priceStats.highest &&
    priceStats.current >= priceStats.highest * 0.95 &&
    (!priceStats.lowest || priceStats.current > priceStats.lowest * 1.05)
  ) {
    cons.push('Currently priced near its historical high');
  }
  if (!product.description) cons.push('Limited product description available');

  if (cons.length === 0) cons.push('No significant drawbacks identified from available data');

  return cons.slice(0, 4);
}

async function findAlternatives(
  supabase: AnySupabaseClient,
  product: Product
): Promise<Product[]> {
  let query = supabase
    .from('products')
    .select('id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at')
    .is('deleted_at', null)
    .neq('id', product.id)
    .limit(5);

  if (product.category) {
    query = query.eq('category', product.category);
  } else if (product.brand) {
    query = query.eq('brand', product.brand);
  }

  const { data } = await query.order('confidence_score', { ascending: false });

  return (data ?? []) as unknown as Product[];
}

async function getCachedSummary(
  supabase: AnySupabaseClient,
  productId: string
): Promise<AISummary | null> {
  const key = cacheKey('ai-summary', productId);
  return swrGet<AISummary | null>(
    key,
    async () => {
      const { data } = await supabase
        .from('ai_summaries')
        .select('*')
        .eq('product_id', productId)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return null;
      const row = data as Record<string, unknown>;
      // Invalidate summaries generated with the old overlapping
      // thresholds: if a cached row contradicts itself (near-low pro
      // AND near-high con), discard it so getAISummary regenerates
      // it with the fixed logic instead of serving the stale
      // contradiction until its 7-day expiry. The bad row is deleted
      // on a best-effort basis (delete may be denied by RLS); even
      // without the delete, the next fetch picks the newest row,
      // which is the regenerated correct one.
      const cachedPros = (row.pros as string[]) ?? [];
      const cachedCons = (row.cons as string[]) ?? [];
      if (
        cachedPros.includes('Currently near its lowest recorded price') &&
        cachedCons.includes('Currently priced near its historical high')
      ) {
        try {
          await supabase.from('ai_summaries').delete().eq('id', row.id as string);
        } catch {
          // Best effort only — returning null still forces a regenerate.
        }
        return null;
      }
      return {
        id: row.id as string,
        productId: row.product_id as string,
        summary: row.summary as string,
        pros: (row.pros as string[]) ?? [],
        cons: (row.cons as string[]) ?? [],
        alternatives: (row.alternatives as string[]) ?? [],
        createdAt: row.created_at as string,
        expiresAt: row.expires_at as string,
      };
    },
    300_000,
    3_600_000
  );
}

async function storeSummary(supabase: AnySupabaseClient, summary: AISummary): Promise<void> {
  try {
    await supabase.from('ai_summaries').insert({
      product_id: summary.productId,
      summary: summary.summary,
      pros: summary.pros,
      cons: summary.cons,
      alternatives: summary.alternatives,
    });
  } catch (err) {
    logger.warn('storeSummary: insert failed', { error: String(err) });
  }
}

async function getReviewsData(
  supabase: AnySupabaseClient,
  productId: string
): Promise<{ avgRating: number; count: number }> {
  const { data } = await supabase
    .from('reviews')
    .select('rating')
    .eq('product_id', productId)
    .is('deleted_at', null)
    .limit(1000);

  const ratings = ((data ?? []) as Array<Record<string, unknown>>).map((r) => r.rating as number);
  const avg = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  return { avgRating: avg, count: ratings.length };
}

async function getAttributesData(
  supabase: AnySupabaseClient,
  productId: string
): Promise<Array<{ key: string; value: string }>> {
  const { data } = await supabase
    .from('product_attributes')
    .select('key, value')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .limit(20);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    key: r.key as string,
    value: r.value as string,
  }));
}

async function getVariantsData(
  supabase: AnySupabaseClient,
  productId: string
): Promise<number> {
  const { count } = await supabase
    .from('product_variants')
    .select('*', { count: 'exact', head: true })
    .eq('product_id', productId)
    .eq('active', true)
    .is('deleted_at', null);

  return count ?? 0;
}

async function getPriceStats(
  supabase: AnySupabaseClient,
  productId: string
): Promise<{ lowest: number | null; highest: number | null; current: number | null }> {
  const { data } = await supabase
    .from('price_history')
    .select('price')
    .eq('product_id', productId)
    .order('recorded_at', { ascending: false })
    .limit(365);

  const prices = ((data ?? []) as Array<Record<string, unknown>>).map((r) => parseFloat(String(r.price)));
  if (prices.length === 0) return { lowest: null, highest: null, current: null };

  return {
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    current: prices[0],
  };
}
