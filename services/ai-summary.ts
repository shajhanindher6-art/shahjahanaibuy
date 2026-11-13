/**
 * AI product summary service.
 * Generates and caches AI summaries with pros, cons, and alternatives.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import { swrGet, cacheKey } from '@/lib/cache';
import {
  formatVerdictFreshnessNote,
  getFreshnessStatus,
} from '@/lib/price-freshness';
import type { AISummary } from '@/types/ai';
import type { Product } from '@/types';
import { normalizePriceVerificationStatus } from '@/services/price-verification';

export async function getAISummary(
  supabase: AnySupabaseClient,
  product: Product
): Promise<AISummary | null> {
  try {
    // Section 19, Phase 2 (§12 #16/#20) — the freshness stamp is
    // attached at READ time from the product's real dataFreshness,
    // never fabricated: a cached row generated a week ago is
    // stamped with the product's actual last-check date, and the
    // freshness note qualifies its stored verdict text (which was
    // written when the price may still have been fresh).
    const priceAsOf = product.dataFreshness ?? null;
    const freshnessNote = formatVerdictFreshnessNote(priceAsOf);
    const cached = await getCachedSummary(supabase, product.id);
    if (cached) return { ...cached, priceAsOf, freshnessNote };

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
      // Section 19, Phase 2 (§12 #16): generated-at is createdAt
      // (the real generation time, above); price-as-of is the
      // product's real dataFreshness — never a fabricated stamp.
      priceAsOf,
      freshnessNote,
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

  // Section 19, Phase 0 (§12 #15): the old fallback claimed the
  // product was "from a reputable brand" when no brand was
  // recorded — an assertion with zero evidence (0 reviews + 0
  // specs live). A missing brand is now simply omitted, never
  // filled in with a reputation claim.
  parts.push(
    `The ${product.name} is a ${product.category ?? 'product'}${product.brand ? ` from ${product.brand}` : ''}.`
  );

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

  // Section 19, Phase 2 (§12 #20) — freshness gate on the
  // interpretive verdicts. "Good time to buy" / "near its
  // historical high" reason about the CURRENT price, so on a stale
  // (or age-unknown) price the verdict is rewritten in the past
  // tense and qualified with the staleness instead of being
  // stated as if it were current. A visitor must never see
  // "Stale price · 10 days old" in one place and an unqualified
  // "good time to buy" in another. Cached rows generated before
  // the price went stale are qualified at read time instead
  // (freshnessNote on the returned AISummary — see getAISummary).
  const verdictNote = formatVerdictFreshnessNote(product.dataFreshness);
  if (priceStats.current && priceStats.lowest) {
    if (priceStats.current <= priceStats.lowest * 1.05) {
      parts.push(
        verdictNote
          ? `The current price was near its historical low at the last recorded check. ${verdictNote}`
          : 'The current price is near its historical low, making it a good time to buy.'
      );
    } else if (priceStats.highest && priceStats.current >= priceStats.highest * 0.9) {
      parts.push(
        verdictNote
          ? `The current price was near its historical high at the last recorded check. ${verdictNote}`
          : 'The current price is near its historical high — you may want to wait for a discount.'
      );
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
  // Section 20, §12 #83 — the old "From established brand: {brand}"
  // pro is REMOVED. A brand name alone is not evidence of quality:
  // no brand-reputation data exists anywhere in the catalog, so a
  // brand string must never be presented as a reason to buy.
  // Likewise, recorded attributes are FACTS, not pros — listing
  // every attribute verbatim as a "pro" praised the product for
  // merely having a recorded spec. Attributes already appear in
  // the summary prose (generateSummary) and on the Specs tab;
  // they do not belong in the pros list.

  if (priceStats.current && priceStats.lowest && priceStats.current <= priceStats.lowest * 1.05) {
    // Section 19, Phase 2 (§12 #20): the near-low pro is an
    // interpretive verdict too — on a stale price it carries the
    // staleness with it instead of reading as a current signal.
    const { status, ageDays } = getFreshnessStatus(product.dataFreshness);
    pros.push(
      status === 'fresh'
        ? 'Currently near its lowest recorded price'
        : status === 'stale'
          ? `Currently near its lowest recorded price (price last checked ${ageDays} day${ageDays === 1 ? '' : 's'} ago — may be out of date)`
          : 'Currently near its lowest recorded price (price age unknown — may be out of date)'
    );
  }

  // Section 19, Phase 0 (§12 #15): the old fallback asserted
  // "Product meets quality standards" when nothing at all was
  // known — a quality claim with zero evidence. With no reviews,
  // no specs and no price signal, the honest answer is that there
  // is not enough data to assess quality.
  if (pros.length === 0)
    pros.push('Not enough data to assess quality — no reviews or specifications recorded for this product');

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
    // Section 20, §12 #83 — the near-high con is an interpretive
    // verdict too: on a stale (or age-unknown) price it carries the
    // staleness with it, exactly like the near-low pro above. The
    // old unqualified "Currently priced near its historical high"
    // read as a current signal on an 11-day-old price.
    const { status, ageDays } = getFreshnessStatus(product.dataFreshness);
    cons.push(
      status === 'fresh'
        ? 'Currently priced near its historical high'
        : status === 'stale'
          ? `Currently priced near its historical high (price last checked ${ageDays} day${ageDays === 1 ? '' : 's'} ago — may be out of date)`
          : 'Currently priced near its historical high (price age unknown — may be out of date)'
    );
  }
  if (!product.description) cons.push('Limited product description available');

  // Section 19, Phase 0 (§12 #15): the old fallback asserted
  // "No significant drawbacks identified from available data"
  // even when the available data was literally nothing — that
  // reads as a clean bill of health. The honest copy says what
  // was actually checked, and names the gap when no reviews exist.
  if (cons.length === 0) {
    cons.push(
      reviews.count === 0
        ? 'No drawbacks identified in the available data — no reviews recorded for this product'
        : 'No drawbacks identified in the available data'
    );
  }

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

  const { data } = await query.order('view_count', { ascending: false });

  // Section 20, §12 #82 — populate the verification rollup on
  // alternatives too (same 045 note as ai-deals.ts: unselected
  // column reads 'unverified' until 045 applies).
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(
    (row) => ({
      ...(row as unknown as Product),
      priceVerificationStatus: normalizePriceVerificationStatus(
        row.price_verification_status
      ),
    })
  );
}

async function getCachedSummary(
  supabase: AnySupabaseClient,
  productId: string
): Promise<AISummary | null> {
  const key = cacheKey('ai-summary', productId);
  return swrGet<AISummary | null>(
    key,
    async () => {
      // Section 18, item 30 — explicit columns (was select('*')):
      // exactly the fields the cached-summary return below reads.
      const { data } = await supabase
        .from('ai_summaries')
        .select('id, product_id, summary, pros, cons, alternatives, created_at, expires_at')
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
      // Section 20, §12 #83 — the invalidation is extended beyond
      // the near-low + near-high contradiction: pre–Section 20
      // cached rows also carry the removed "From established brand"
      // pro and the UNQUALIFIED near-low pro / near-high con, which
      // read as current signals on a stale price. Any of those
      // patterns discards the row so it regenerates with the fixed
      // copy instead of being served until its 7-day expiry.
      const hasStaleCopy =
        cachedPros.some((p) => p.startsWith('From established brand:')) ||
        cachedPros.includes('Currently near its lowest recorded price') ||
        cachedCons.includes('Currently priced near its historical high');
      if (hasStaleCopy) {
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
        // Stamped by getAISummary at read time from the product's
        // real dataFreshness (§12 #16) — the ai_summaries table
        // carries no freshness columns, and a cached row must never
        // be re-stamped with a date it did not earn.
        priceAsOf: null,
        freshnessNote: null,
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
