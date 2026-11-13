/**
 * Personal Shopping Assistant — the recommendation engine behind
 * the floating AI Deal Finder widget (POST /api/v1/deal-finder)
 * and the dashboard chat (POST /api/v1/chat/messages).
 *
 * HARD RULES (enforced here, in code — there is no LLM prompt in
 * this codebase; the deterministic parser in ai-search.ts IS the
 * query-understanding layer):
 *
 * 1. NO DEMO / UNPRICED RECOMMENDATIONS. The "Sample Laptop" row
 *    (slug `sample-laptop`, a database health-check row) and any
 *    product without a verified price are dropped from EVERY
 *    recommendation path. A product counts as priced only when it
 *    has a merchant listing AND a resolvable price (latest
 *    price_history record, falling back to its merchant listing
 *    price). When filtering leaves zero products, the answer says
 *    so honestly — it never fills the gap with a demo item.
 * 2. BUDGET IS A HARD FILTER for recommendations. Only products
 *    with verified price <= budget are recommended; over-budget
 *    products never appear as recommendations (the /search page
 *    may still list them — this module is the assistant, not
 *    search).
 * 3. COUNTRY-AWARE PRICES. Prices are formatted with the
 *    visitor's region (lib/region.ts): USD visitors see "$999.00";
 *    everyone else sees "≈ <converted> (<USD>)" exactly like the
 *    <Price/> component. The best retailer's localized Amazon
 *    domain is named (Best Buy is never rewritten).
 * 4. PRICE HISTORY, never invented. From services/price-history.ts:
 *    current / lowest / highest / average / trend. No history
 *    rows means "no recorded price history yet", never a guess.
 * 5. BEST DEAL, never invented. The best retailer's real merchant
 *    coupon (coupons table) and the product's real cashback offer
 *    (cashback_offers table) are shown when they exist, with the
 *    honest note that codes apply at the retailer's checkout,
 *    not inside SmartBuy.
 * 6. HONEST EXPLANATIONS. The "why" lines cite only verified
 *    data (price, budget, retailer, coupon, history position).
 *    Specs are never invented and 0 reviews are stated as
 *    "no reviews yet (abhi reviews nahi)", never a fake rating.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  FALLBACK_REGION,
  formatPriceForRegion,
  formatUsd,
  localizeAmazonUrl,
  type Region,
} from '@/lib/region';
import { formatOriginalAmount } from './currency';
import { getLatestPrices, getPriceHistory } from './price-history';
import { predictBuyVsWait, type BuyWaitPoint } from './buy-wait-prediction';
import { getAISummary } from './ai-summary';
import { formatLabelDate } from '@/lib/ai-source-label';
import type { ParsedSearchIntent } from '@/types/ai';
import type { Product } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Slugs that must never be recommended (demo / health-check rows). */
export const DEMO_EXCLUDED_SLUGS = ['sample-laptop'] as const;

export interface AssistantRetailer {
  merchantId: string;
  name: string;
  slug: string;
  price: number;
  compareAt: number | null;
  url: string | null;
  inStock: boolean;
}

export interface AssistantHistory {
  current: number;
  lowest: number;
  highest: number;
  average: number;
  change: number | null;
  points: number;
}

export interface AssistantCoupon {
  code: string;
  discountType: string;
  discountValue: number;
  /** Expiry from the coupons table, or null when none is recorded.
   *  enrichProducts already drops expired rows; this lets answers
   *  label the coupon with its validity ("valid until …"). */
  validUntil: string | null;
}

export interface AssistantCashback {
  title: string;
  cashbackType: string;
  cashbackValue: number;
}

export interface EnrichedProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  confidenceScore: number;
  /** Verified USD price — always present (unpriced rows are dropped). */
  price: number;
  bestRetailer: AssistantRetailer;
  history: AssistantHistory | null;
  coupons: AssistantCoupon[];
  cashback: AssistantCashback[];
  reviewCount: number;
  reviewAvg: number | null;
}

export interface AssistantProductCard {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  imageUrl: string | null;
  /** USD price, for the widget to re-format in the visitor's currency. */
  price: number;
}

export interface AssistantAnswer {
  content: string;
  metadata: {
    products: AssistantProductCard[];
    intent?: string;
    budget?: number;
    comparison?: string;
  } | null;
}

interface BasicProductRow {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  confidence_score: number;
}

// ---------------------------------------------------------------------------
// Enrichment: verified price + best retailer + savings + reviews
// ---------------------------------------------------------------------------

function parseNum(value: unknown): number | null {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/**
 * Enrich product rows with everything a recommendation needs.
 * DROPS (never returns): demo slugs, products with no merchant
 * listing, and products with no resolvable price. Callers must
 * not re-add dropped rows — a dropped row is the honest
 * "no priced match" case, not a gap to fill.
 */
export async function enrichProducts(
  supabase: AnySupabaseClient,
  rows: BasicProductRow[],
  options: { withHistory?: boolean } = {}
): Promise<EnrichedProduct[]> {
  const candidates = rows.filter((r) => !(DEMO_EXCLUDED_SLUGS as readonly string[]).includes(r.slug));
  const ids = candidates.map((r) => r.id);
  if (ids.length === 0) return [];

  const [mpRes, latestPrices, reviewsRes] = await Promise.all([
    supabase
      .from('merchant_products')
      .select('product_id, merchant_id, price, compare_at_price, url, in_stock')
      .in('product_id', ids)
      .is('deleted_at', null)
      .limit(500),
    getLatestPrices(supabase, ids),
    supabase
      .from('reviews')
      .select('product_id, rating')
      .in('product_id', ids)
      .is('deleted_at', null)
      .limit(1000),
  ]);

  const mpRows = (mpRes.data ?? []) as Array<{
    product_id: string;
    merchant_id: string;
    price: number | string;
    compare_at_price: number | string | null;
    url: string | null;
    in_stock: boolean;
  }>;
  const merchantIds = Array.from(new Set(mpRows.map((r) => r.merchant_id).filter(Boolean)));

  const [merchantRes, couponRes, cashbackRes] = await Promise.all([
    merchantIds.length > 0
      ? supabase.from('merchants').select('id, name, slug').in('id', merchantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; slug: string }> }),
    merchantIds.length > 0
      ? supabase
          .from('coupons')
          .select('code, merchant_id, discount_type, discount_value, valid_until')
          .in('merchant_id', merchantIds)
          .eq('active', true)
          .limit(200)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    supabase
      .from('cashback_offers')
      .select('merchant_id, product_id, title, cashback_type, cashback_value, end_at')
      .in('product_id', ids)
      .eq('active', true)
      .is('deleted_at', null)
      .limit(200),
  ]);

  const merchantById = new Map(
    ((merchantRes.data ?? []) as Array<{ id: string; name: string; slug: string }>).map((m) => [
      m.id,
      { name: m.name, slug: m.slug },
    ])
  );
  const now = Date.now();
  const couponsByMerchant = new Map<string, AssistantCoupon[]>();
  for (const row of (couponRes.data ?? []) as Array<Record<string, unknown>>) {
    const validUntil = row.valid_until as string | null;
    if (validUntil && new Date(validUntil).getTime() < now) continue;
    const merchantId = row.merchant_id as string;
    const list = couponsByMerchant.get(merchantId) ?? [];
    list.push({
      code: row.code as string,
      discountType: row.discount_type as string,
      discountValue: parseNum(row.discount_value) ?? 0,
      validUntil: (row.valid_until as string | null) ?? null,
    });
    couponsByMerchant.set(merchantId, list);
  }
  const cashbackByProduct = new Map<string, AssistantCashback[]>();
  for (const row of (cashbackRes.data ?? []) as Array<Record<string, unknown>>) {
    const endAt = row.end_at as string | null;
    if (endAt && new Date(endAt).getTime() < now) continue;
    const productId = row.product_id as string | null;
    if (!productId) continue;
    const list = cashbackByProduct.get(productId) ?? [];
    list.push({
      title: row.title as string,
      cashbackType: row.cashback_type as string,
      cashbackValue: parseNum(row.cashback_value) ?? 0,
    });
    cashbackByProduct.set(productId, list);
  }

  const ratingSum = new Map<string, number>();
  const ratingCount = new Map<string, number>();
  for (const row of (reviewsRes.data ?? []) as Array<{ product_id: string; rating: number | string }>) {
    const rating = parseNum(row.rating);
    if (rating === null) continue;
    ratingSum.set(row.product_id, (ratingSum.get(row.product_id) ?? 0) + rating);
    ratingCount.set(row.product_id, (ratingCount.get(row.product_id) ?? 0) + 1);
  }

  const listingsByProduct = new Map<string, typeof mpRows>();
  for (const row of mpRows) {
    const list = listingsByProduct.get(row.product_id) ?? [];
    list.push(row);
    listingsByProduct.set(row.product_id, list);
  }

  const enriched: EnrichedProduct[] = [];
  for (const row of candidates) {
    const listings = listingsByProduct.get(row.id) ?? [];
    // No merchant listing -> no verified store price -> never recommended.
    if (listings.length === 0) continue;
    const inStock = listings.filter((l) => l.in_stock);
    const pool = inStock.length > 0 ? inStock : listings;
    const bestListing = [...pool].sort(
      (a, b) => (parseNum(a.price) ?? Infinity) - (parseNum(b.price) ?? Infinity)
    )[0];
    // Verified price: latest recorded price_history value first
    // (consistent with search), merchant listing price as fallback.
    const price = latestPrices.get(row.id) ?? parseNum(bestListing.price);
    if (price === null) continue;

    const merchant = merchantById.get(bestListing.merchant_id);
    const bestRetailer: AssistantRetailer = {
      merchantId: bestListing.merchant_id,
      name: merchant?.name ?? 'Retailer',
      slug: merchant?.slug ?? '',
      price: parseNum(bestListing.price) ?? price,
      compareAt: parseNum(bestListing.compare_at_price),
      url: bestListing.url,
      inStock: bestListing.in_stock,
    };

    enriched.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      brand: row.brand,
      category: row.category,
      imageUrl: row.image_url,
      confidenceScore: row.confidence_score ?? 50,
      price,
      bestRetailer,
      history: null,
      coupons: couponsByMerchant.get(bestListing.merchant_id) ?? [],
      cashback: cashbackByProduct.get(row.id) ?? [],
      reviewCount: ratingCount.get(row.id) ?? 0,
      reviewAvg:
        (ratingCount.get(row.id) ?? 0) > 0
          ? Math.round(((ratingSum.get(row.id) ?? 0) / (ratingCount.get(row.id) ?? 1)) * 10) / 10
          : null,
    });
  }

  if (options.withHistory) {
    await attachHistory(supabase, enriched);
  }

  return enriched;
}

/** Fill the `history` field of already-enriched products in place. */
export async function attachHistory(
  supabase: AnySupabaseClient,
  products: EnrichedProduct[]
): Promise<void> {
  await Promise.all(
    products.map(async (p) => {
      try {
        const result = await getPriceHistory(supabase, p.id, { limit: 100 });
        if (result.history.length > 0 && result.lowestPrice !== null && result.highestPrice !== null) {
          const sum = result.history.reduce((acc, h) => acc + h.price, 0);
          p.history = {
            current: result.currentPrice ?? p.price,
            lowest: result.lowestPrice,
            highest: result.highestPrice,
            average: Math.round((sum / result.history.length) * 100) / 100,
            change: result.priceChange,
            points: result.history.length,
          };
        }
      } catch {
        p.history = null;
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Formatting (region-aware, plain text — mirrors <Price/>)
// ---------------------------------------------------------------------------

/** "≈ Rs 279,720 ($999.00)" for PKR, "$999.00" for USD. */
export function formatPriceText(usd: number, region: Region): string {
  if (region.currency === 'USD') return formatUsd(usd);
  const { display } = formatPriceForRegion(usd, region);
  return `≈ ${display} (${formatUsd(usd)})`;
}

export function budgetLabel(intent: ParsedSearchIntent): string {
  if (
    intent.budget !== null &&
    intent.budgetCurrency &&
    intent.budgetCurrency !== 'USD' &&
    intent.budgetOriginal !== null
  ) {
    return `${formatOriginalAmount(intent.budgetOriginal)} ${intent.budgetCurrency} (≈ $${intent.budget} USD)`;
  }
  return intent.budget !== null ? `$${intent.budget}` : '';
}

/** Localized Amazon domain for a retailer, e.g. "amazon.de"; Best Buy stays "bestbuy.com". */
export function retailerDomain(retailer: AssistantRetailer, region: Region): string {
  if (retailer.slug === 'amazon' && retailer.url) {
    const localized = localizeAmazonUrl(retailer.url, region);
    if (localized) {
      try {
        return new URL(localized).hostname;
      } catch {
        return region.amazonDomain;
      }
    }
    return region.amazonDomain;
  }
  try {
    return retailer.url ? new URL(retailer.url).hostname : retailer.name;
  } catch {
    return retailer.name;
  }
}

function historyText(product: EnrichedProduct, region: Region): string {
  const h = product.history;
  if (!h) return 'No recorded price history is available for this product yet.';
  const parts = [
    `Price history (${h.points} recorded points): current ${formatPriceText(h.current, region)}, ` +
      `lowest ${formatPriceText(h.lowest, region)}, highest ${formatPriceText(h.highest, region)}, ` +
      `average ${formatPriceText(h.average, region)}.`,
  ];
  if (h.current <= h.lowest) {
    parts.push('It is at its lowest recorded price right now.');
  } else if (h.change !== null && h.change < 0) {
    parts.push(`Down ${formatPriceText(Math.abs(h.change), region)} from the previous recorded price.`);
  } else if (h.change !== null && h.change > 0) {
    parts.push(`Up ${formatPriceText(h.change, region)} from the previous recorded price.`);
  } else if (h.change === 0) {
    parts.push('Unchanged from the previous recorded price.');
  }
  return parts.join(' ');
}

function savingsText(product: EnrichedProduct): string | null {
  const bits: string[] = [];
  for (const c of product.coupons) {
    bits.push(
      `coupon ${c.code} (${c.discountType === 'percentage' ? `${c.discountValue}% off` : `$${c.discountValue} off`})`
    );
  }
  for (const cb of product.cashback) {
    bits.push(
      `${cb.title} (${cb.cashbackType === 'percentage' ? `${cb.cashbackValue}% cashback` : `$${cb.cashbackValue} cashback`})`
    );
  }
  return bits.length > 0 ? bits.join(' + ') : null;
}

function reviewsText(product: EnrichedProduct): string {
  if (product.reviewCount === 0) return 'Reviews: no reviews yet (abhi reviews nahi).';
  return `Reviews: ${product.reviewAvg}/5 from ${product.reviewCount} review${product.reviewCount === 1 ? '' : 's'}.`;
}

function whyText(
  product: EnrichedProduct,
  region: Region,
  ctx: { budget: number | null; budgetText: string; lowestAmong: number | null; isPick: boolean }
): string {
  const reasons: string[] = [];
  if (ctx.budget !== null) reasons.push(`within your ${ctx.budgetText} budget`);
  if (ctx.lowestAmong !== null && ctx.lowestAmong > 1) {
    reasons.push(`the lowest verified price among ${ctx.lowestAmong} matching products`);
  }
  reasons.push(
    `best price at ${product.bestRetailer.name} (${retailerDomain(product.bestRetailer, region)})` +
      (product.bestRetailer.inStock ? ', in stock' : ', currently listed as out of stock')
  );
  const savings = savingsText(product);
  if (savings) reasons.push(`comes with ${savings}`);
  if (product.history && product.history.current <= product.history.lowest) {
    reasons.push('at its lowest recorded price');
  }
  return `Why this one: ${reasons.join('; ')}.`;
}

function toCard(p: EnrichedProduct): AssistantProductCard {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    brand: p.brand,
    imageUrl: p.imageUrl,
    price: p.price,
  };
}

function scopeText(intent: ParsedSearchIntent): string {
  const bits: string[] = [];
  if (intent.category) bits.push(intent.category);
  if (intent.brands.length > 0) bits.push(`from ${intent.brands.join(', ')}`);
  if (intent.budget !== null) bits.push(`under your ${budgetLabel(intent)} budget`);
  return bits.length > 0 ? bits.join(' ') : 'your request';
}

function noMatchAnswer(intent: ParsedSearchIntent): AssistantAnswer {
  return {
    content:
      `I couldn't find a priced product matching ${scopeText(intent)}. ` +
      `I only recommend products with a verified price — demo items and products without a listed price are never shown as recommendations. ` +
      `Try a different category, brand, or a higher budget.`,
    metadata: null,
  };
}

// ---------------------------------------------------------------------------
// Recommend intent (incl. best-under-budget)
// ---------------------------------------------------------------------------

export async function recommendAssistant(
  supabase: AnySupabaseClient,
  intent: ParsedSearchIntent,
  searchTerms: string,
  region: Region = FALLBACK_REGION
): Promise<AssistantAnswer> {
  try {
    // One OR group: category match OR text match. (Chaining a
    // separate .ilike('category') after .or(...) would AND them
    // and hide products whose description never says "laptop".)
    const orConditions: string[] = [];
    if (intent.category) orConditions.push(`category.ilike.%${intent.category}%`);
    if (searchTerms) {
      orConditions.push(
        `name.ilike.%${searchTerms}%,description.ilike.%${searchTerms}%,brand.ilike.%${searchTerms}%`
      );
    }

    let query = supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url, confidence_score')
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop');

    if (orConditions.length > 0) query = query.or(orConditions.join(','));
    if (intent.brands.length > 0) {
      query = query.or(intent.brands.map((b) => `brand.ilike.%${b}%`).join(','));
    }

    const { data, error } = await query
      .order('confidence_score', { ascending: false })
      .limit(12);

    if (error || !data || data.length === 0) return noMatchAnswer(intent);

    let products = await enrichProducts(supabase, data as unknown as BasicProductRow[]);
    // HARD budget filter: over-budget products never appear as
    // recommendations, even if they matched the category/brand.
    if (intent.budget !== null) {
      products = products.filter((p) => p.price <= intent.budget!);
    }
    if (products.length === 0) return noMatchAnswer(intent);

    // Best = lowest verified price when the visitor asked for
    // best / cheap / budget, otherwise highest confidence first.
    const priceLed = intent.budget !== null || ['best', 'top', 'cheap', 'budget', 'affordable'].includes(intent.intent);
    products.sort((a, b) =>
      priceLed ? a.price - b.price || b.confidenceScore - a.confidenceScore : b.confidenceScore - a.confidenceScore || a.price - b.price
    );

    const top = products[0];
    // Full history for the top pick only (the other options get
    // price + retailer lines; their history lives on their page).
    await attachHistory(supabase, [top]);

    const budgetText = budgetLabel(intent);
    const lines: string[] = [];
    lines.push(`🏆 Best pick for you: ${top.name}${top.brand ? ` (${top.brand})` : ''}`);
    lines.push(
      `Price: ${formatPriceText(top.price, region)} at ${top.bestRetailer.name} ` +
        `(${retailerDomain(top.bestRetailer, region)})${top.bestRetailer.inStock ? ' — In Stock' : ''}.`
    );
    lines.push(whyText(top, region, { budget: intent.budget, budgetText, lowestAmong: products.length, isPick: true }));
    lines.push(historyText(top, region));
    const topSavings = savingsText(top);
    if (topSavings) {
      lines.push(
        `Best deal: ${topSavings}. Coupon codes apply at the retailer's checkout, not inside SmartBuy.`
      );
    }
    lines.push(reviewsText(top));

    const others = products.slice(1, 4);
    if (others.length > 0) {
      lines.push('');
      lines.push(intent.budget !== null ? 'Other options within your budget:' : 'Other options:');
      for (const p of others) {
        lines.push(
          `• ${p.name}${p.brand ? ` (${p.brand})` : ''} — ${formatPriceText(p.price, region)} at ` +
            `${p.bestRetailer.name} (${retailerDomain(p.bestRetailer, region)}).`
        );
      }
    }

    lines.push('');
    lines.push('Open a product card below for full specs, price history, and to set a price alert.');

    return {
      content: lines.join('\n'),
      metadata: {
        products: products.slice(0, 4).map(toCard),
        intent: intent.intent,
        budget: intent.budget ?? undefined,
      },
    };
  } catch (err) {
    logger.error('recommendAssistant: unexpected error', { error: String(err) });
    return {
      content: 'Sorry, I could not find deals right now. Please try again.',
      metadata: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Compare intent
// ---------------------------------------------------------------------------

const GENERIC_TOKENS = new Set([
  'air', 'pro', 'ultra', 'max', 'plus', 'mini', 'the', 'and', 'vs', 'versus', 'compare',
  'best', 'cheapest', 'cheaper', 'which', 'one', 'for', 'most', 'buyers', 'between',
]);

function escapeRegExp(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match products the visitor named, by distinctive name/brand
 * tokens ("MacBook vs Dell" -> MacBook Air 13 + Dell XPS 13;
 * follow-up chips send full names, which match on every token).
 * Returns at most 3, best token coverage first.
 */
function matchProductsByName(message: string, rows: BasicProductRow[]): BasicProductRow[] {
  const lower = message.toLowerCase();
  const scored: Array<{ row: BasicProductRow; score: number }> = [];
  for (const row of rows) {
    const tokens = new Set<string>();
    for (const part of row.name.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 3 || /\d/.test(part)) tokens.add(part);
    }
    if (row.brand) tokens.add(row.brand.toLowerCase());
    let score = 0;
    for (const token of tokens) {
      if (GENERIC_TOKENS.has(token)) continue;
      if (new RegExp(`\\b${escapeRegExp(token)}\\b`).test(lower)) score += 1;
    }
    if (score > 0) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((s) => s.row);
}

export async function compareAssistant(
  supabase: AnySupabaseClient,
  message: string,
  intent: ParsedSearchIntent,
  region: Region = FALLBACK_REGION
): Promise<AssistantAnswer> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url, confidence_score')
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop')
      .order('confidence_score', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return {
        content:
          `I'd love to help you compare products! Please tell me which products you'd like to compare. ` +
          `For example, "compare MacBook Air 13 vs Dell XPS 13", or use the Compare page for a detailed side-by-side comparison.`,
        metadata: null,
      };
    }

    const matched = matchProductsByName(message, data as unknown as BasicProductRow[]);
    if (matched.length < 2) {
      return {
        content:
          `I couldn't identify two products to compare from that message. Please name both products, ` +
          `for example "compare MacBook Air 13 vs Dell XPS 13".`,
        metadata: null,
      };
    }

    let products = await enrichProducts(supabase, matched, { withHistory: true });
    // Products that lost their price are not comparable on price —
    // they drop out instead of appearing with a guessed figure.
    const droppedUnpriced = matched.filter((m) => !products.some((p) => p.id === m.id));

    let droppedOverBudget: EnrichedProduct[] = [];
    if (intent.budget !== null) {
      const inBudget = products.filter((p) => p.price <= intent.budget!);
      droppedOverBudget = products.filter((p) => p.price > intent.budget!);
      products = inBudget;
    }
    if (products.length < 2) {
      const reasons: string[] = [];
      if (droppedUnpriced.length > 0) {
        reasons.push(`${droppedUnpriced.map((p) => p.name).join(', ')} has no verified price`);
      }
      if (droppedOverBudget.length > 0) {
        reasons.push(
          `${droppedOverBudget.map((p) => `${p.name} (${formatPriceText(p.price, region)})`).join(', ')} ` +
            `is above your ${budgetLabel(intent)} budget`
        );
      }
      return {
        content:
          `I couldn't build a fair comparison: ${reasons.join('; ') || 'not enough priced products matched'}. ` +
          `Only products with a verified price${intent.budget !== null ? ' within your budget' : ''} are compared — demo and unpriced items are never included.`,
        metadata: null,
      };
    }

    const pick = [...products].sort((a, b) => a.price - b.price)[0];
    const lines: string[] = [];
    lines.push(`Here's how they compare (verified prices, lowest first):`);
    lines.push('');
    for (const p of [...products].sort((a, b) => a.price - b.price)) {
      lines.push(
        `• ${p.name}${p.brand ? ` (${p.brand})` : ''} — ${formatPriceText(p.price, region)} at ` +
          `${p.bestRetailer.name} (${retailerDomain(p.bestRetailer, region)})${p.bestRetailer.inStock ? ', In Stock' : ''}.`
      );
      lines.push(`  ${historyText(p, region)}`);
      const savings = savingsText(p);
      if (savings) lines.push(`  Deal: ${savings}.`);
      lines.push(`  ${reviewsText(p)}`);
    }
    lines.push('');
    lines.push(
      `🏆 Best pick: ${pick.name} — ${whyText(pick, region, {
        budget: intent.budget,
        budgetText: budgetLabel(intent),
        lowestAmong: products.length,
        isPick: true,
      })}`
    );
    if (droppedOverBudget.length > 0) {
      lines.push(
        `Note: ${droppedOverBudget.map((p) => p.name).join(', ')} was left out because it is above your ${budgetLabel(intent)} budget.`
      );
    }
    lines.push('Coupon codes apply at the retailer\'s checkout, not inside SmartBuy.');

    return {
      content: lines.join('\n'),
      metadata: {
        products: products.map(toCard),
        comparison: products.map((p) => p.name).join(' vs '),
        intent: intent.intent,
        budget: intent.budget ?? undefined,
      },
    };
  } catch (err) {
    logger.error('compareAssistant: unexpected error', { error: String(err) });
    return {
      content: 'Sorry, I could not compare products right now. Please try again.',
      metadata: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Buy-now-or-wait intent ("should I buy the MacBook now or wait?")
// ---------------------------------------------------------------------------

/**
 * Answer buy/wait questions with a verdict from the existing
 * deterministic buy-vs-wait engine (services/buy-wait-prediction,
 * Section 19, Phase 0, §12 #52). Until now the question fell
 * through to recommendAssistant() and was answered as a generic
 * product search — not as a verdict.
 *
 * The verdict is computed ONLY from the product's real recorded
 * price_history points (the engine refuses below 2 points and
 * caps confidence at 25% on thin history), and the answer labels
 * it an estimate, never a guarantee. No LLM, no invented data:
 * with no product named, the answer asks which product; with no
 * price history, it says so honestly instead of guessing.
 */
export async function buyWaitAssistant(
  supabase: AnySupabaseClient,
  message: string,
  region: Region = FALLBACK_REGION
): Promise<AssistantAnswer> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url, confidence_score')
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop')
      .order('confidence_score', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return {
        content:
          'I could not look up any products right now, so I cannot give you a buy-now-or-wait verdict. Please try again.',
        metadata: null,
      };
    }

    const matched = matchProductsByName(message, data as unknown as BasicProductRow[]);
    if (matched.length === 0) {
      return {
        content:
          'I can tell you whether to buy now or wait from the product\'s recorded price history — which product? ' +
          'For example, "should I buy the MacBook Air 13 now or wait?"',
        metadata: null,
      };
    }

    const row = matched[0];
    const { data: historyRows } = await supabase
      .from('price_history')
      .select('price, recorded_at')
      .eq('product_id', row.id)
      .order('recorded_at', { ascending: true })
      .limit(365);

    const points: BuyWaitPoint[] = ((historyRows ?? []) as Array<Record<string, unknown>>)
      .map((r) => ({
        price: parseFloat(String(r.price)),
        recordedAt: r.recorded_at as string,
      }))
      .filter((p) => Number.isFinite(p.price) && p.price > 0);

    const prediction = predictBuyVsWait(points);

    // The product card (verified merchant price) when the product
    // has one — enrichProducts drops unpriced rows, and a dropped
    // row must not lose the verdict, which stands on history alone.
    const enriched = await enrichProducts(supabase, [row]);
    const card = enriched.length > 0 ? toCard(enriched[0]) : null;

    const verdict =
      prediction.recommendation === 'buy_now'
        ? 'Buy Now'
        : prediction.recommendation === 'wait'
          ? 'Wait'
          : prediction.recommendation === 'track_price'
            ? 'Track Price'
            : prediction.recommendation === 'compare_alternatives'
              ? 'Compare Alternatives'
              : 'Not enough data';
    const lines: string[] = [];
    lines.push(`🛒 Verdict for ${row.name}: ${verdict}`);
    lines.push(prediction.reason);
    if (prediction.recommendation === 'not_enough_data') {
      lines.push(
        'Set a price alert on the product page and check back once more prices are recorded — I cannot give a verdict from this little history.'
      );
    } else {
      const confidenceLine =
        `Confidence: ${prediction.confidence}%` +
        (prediction.lowConfidence
          ? ` (low — only ${prediction.pointCount} recorded price${prediction.pointCount === 1 ? '' : 's'})`
          : '');
      lines.push(`${confidenceLine}. This is an estimate from recorded price history, not a guarantee.`);
      if (prediction.currentPrice !== null && prediction.lowestPrice !== null && prediction.averagePrice !== null) {
        lines.push(
          `Current: ${formatPriceText(prediction.currentPrice, region)} · ` +
            `Lowest recorded: ${formatPriceText(prediction.lowestPrice, region)} · ` +
            `Average: ${formatPriceText(prediction.averagePrice, region)}`
        );
      }
    }
    lines.push('Open the product card below for the full price history and to set a price alert.');

    return {
      content: lines.join('\n'),
      metadata: {
        products: card ? [card] : [],
        intent: 'buy_wait',
      },
    };
  } catch (err) {
    logger.error('buyWaitAssistant: unexpected error', { error: String(err) });
    return {
      content: 'Sorry, I could not work out a buy-now-or-wait verdict right now. Please try again.',
      metadata: null,
    };
  }
}

// ---------------------------------------------------------------------------
// "Is this price competitive?" intent
// ---------------------------------------------------------------------------

/**
 * Answer competitiveness questions from real data only (Section 19,
 * Phase 5, §12 #53 — same gap family as the buy/wait handler in
 * Phase 0, §12 #52). The verdict compares the current recorded
 * price against the product's own recorded low / average / high
 * (never a guessed market price) and against the other merchants
 * listing the same product, and states the freshness of the price.
 * With no recorded history the answer says there is not enough data
 * to judge — it never calls a price competitive on zero evidence.
 */
export async function competitivenessAssistant(
  supabase: AnySupabaseClient,
  message: string,
  region: Region = FALLBACK_REGION
): Promise<AssistantAnswer> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url, confidence_score, data_freshness')
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop')
      .order('confidence_score', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return {
        content:
          'I could not look up any products right now, so I cannot judge whether a price is competitive. Please try again.',
        metadata: null,
      };
    }

    const matched = matchProductsByName(message, data as unknown as BasicProductRow[]);
    if (matched.length === 0) {
      return {
        content:
          'I can tell you whether a price is competitive from the product\'s recorded price history and merchant prices — which product? ' +
          'For example, "is the price of the MacBook Air 13 competitive?"',
        metadata: null,
      };
    }

    const row = matched[0];
    const dataFreshness =
      ((row as unknown as Record<string, unknown>).data_freshness as string | null) ?? null;

    const enriched = await enrichProducts(supabase, [row], { withHistory: true });
    const product = enriched[0] ?? null;
    if (!product) {
      return {
        content:
          `I couldn't find a verified price for ${row.name}, so I cannot judge whether its price is competitive — ` +
          `I only assess products with a verified price. Try naming a product from the catalog.`,
        metadata: null,
      };
    }

    // Merchant comparison: every live listing for this product, so
    // the cheapest merchant is named from recorded rows, not memory.
    const { data: listingsData } = await supabase
      .from('merchant_products')
      .select('merchant_id, price, in_stock')
      .eq('product_id', row.id)
      .is('deleted_at', null)
      .order('price', { ascending: true });
    const listingRows = ((listingsData ?? []) as Array<Record<string, unknown>>)
      .map((r) => ({ merchantId: r.merchant_id as string, price: parseFloat(String(r.price)) }))
      .filter((l) => Number.isFinite(l.price) && l.price > 0);
    const merchantIds = [...new Set(listingRows.map((l) => l.merchantId))];
    const merchantNames = new Map<string, string>();
    if (merchantIds.length > 0) {
      const { data: merchantRows } = await supabase
        .from('merchants')
        .select('id, name')
        .in('id', merchantIds);
      for (const m of (merchantRows ?? []) as Array<Record<string, unknown>>) {
        merchantNames.set(m.id as string, m.name as string);
      }
    }

    const lines: string[] = [];
    lines.push(`💰 Is the price of ${row.name} competitive?`);
    lines.push(
      `Current verified price: ${formatPriceText(product.price, region)} at ${product.bestRetailer.name} ` +
        `(${retailerDomain(product.bestRetailer, region)}).`
    );

    if (listingRows.length > 1) {
      const cheapest = listingRows[0];
      const dearest = listingRows[listingRows.length - 1];
      lines.push(
        `${listingRows.length} merchants list this product. Cheapest: ` +
          `${merchantNames.get(cheapest.merchantId) ?? 'Retailer'} at ${formatPriceText(cheapest.price, region)}; ` +
          `most expensive: ${merchantNames.get(dearest.merchantId) ?? 'Retailer'} at ${formatPriceText(dearest.price, region)}.`
      );
    } else if (listingRows.length === 1) {
      lines.push('Only one merchant lists this product, so there is no merchant comparison to make.');
    }

    const h = product.history;
    // A verdict needs at least 2 recorded points: with a single
    // point, lowest = average = highest = current, so "at its
    // lowest" would be vacuous. Below 2 points the honest answer
    // is not enough data (same bar as the buy-vs-wait engine).
    if (!h || h.points < 2) {
      lines.push(
        'I don\'t have enough recorded price history to judge whether this price is competitive — ' +
          'no price history is recorded for this product yet, so there is no low or average to compare against.'
      );
    } else {
      lines.push(
        `Recorded price history (${h.points} point${h.points === 1 ? '' : 's'}): ` +
          `lowest ${formatPriceText(h.lowest, region)}, average ${formatPriceText(h.average, region)}, ` +
          `highest ${formatPriceText(h.highest, region)}.`
      );
      const range = h.highest - h.lowest;
      if (h.current <= h.lowest) {
        lines.push('Verdict: yes — competitive. It is at its lowest recorded price right now.');
      } else if (range <= 0) {
        lines.push(
          'Verdict: the recorded price has not moved across its history, so there is no recorded basis to call it a bargain or overpriced — it is the only recorded price.'
        );
      } else {
        const position = (h.current - h.lowest) / range;
        if (position <= 0.25) {
          lines.push('Verdict: yes — competitive. It is near its lowest recorded price.');
        } else if (h.current <= h.average) {
          lines.push('Verdict: fairly competitive — below its recorded average price.');
        } else if (position <= 0.75) {
          lines.push('Verdict: mixed — above its recorded average price, but below its recorded high.');
        } else {
          lines.push('Verdict: not competitive right now — near its highest recorded price.');
        }
      }
    }

    const freshDate = formatLabelDate(dataFreshness);
    lines.push(
      freshDate
        ? `Price last checked ${freshDate} — a competitiveness verdict is only as fresh as its last recorded check.`
        : 'Price age unknown — the product records no freshness timestamp, so treat this as a recorded-price comparison, not a live check.'
    );
    lines.push('Open the product card below for the full price history and to set a price alert.');

    return {
      content: lines.join('\n'),
      metadata: {
        products: [toCard(product)],
        intent: 'price_competitiveness',
      },
    };
  } catch (err) {
    logger.error('competitivenessAssistant: unexpected error', { error: String(err) });
    return {
      content: 'Sorry, I could not judge price competitiveness right now. Please try again.',
      metadata: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Pros / cons intent
// ---------------------------------------------------------------------------

/**
 * Answer "pros and cons?" from the REAL ai-summary output (Section
 * 19, Phase 5, §12 #54) plus real recorded signals — never invented
 * pros/cons. The summary service (Phase 0/2) is honest by
 * construction: with 0 reviews + 0 specs its pros say there is not
 * enough data to assess quality, and this handler repeats that
 * instead of filling the gap. Recorded signals (price position,
 * reviews, discount, specs presence) are listed separately, and
 * what ISN'T known is named explicitly.
 */
export async function prosConsAssistant(
  supabase: AnySupabaseClient,
  message: string,
  region: Region = FALLBACK_REGION
): Promise<AssistantAnswer> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select(
        'id, name, slug, description, brand, category, image_url, gtin, confidence_score, data_freshness, created_at, updated_at'
      )
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop')
      .order('confidence_score', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return {
        content:
          'I could not look up any products right now, so I cannot list pros and cons. Please try again.',
        metadata: null,
      };
    }

    const matched = matchProductsByName(message, data as unknown as BasicProductRow[]);
    if (matched.length === 0) {
      return {
        content:
          'I can list the pros and cons of a product from its recorded data — which product? ' +
          'For example, "what are the pros and cons of the MacBook Air 13?"',
        metadata: null,
      };
    }

    const row = matched[0];
    const summary = await getAISummary(supabase, row as unknown as Product);
    if (!summary) {
      return {
        content:
          `I could not build a pros-and-cons list for ${row.name} right now. Please try again.`,
        metadata: null,
      };
    }

    const enriched = await enrichProducts(supabase, [row], { withHistory: true });
    const product = enriched[0] ?? null;

    // Specs presence: one probe row — a product with no recorded
    // specifications cannot be assessed on battery, RAM or similar
    // qualities, and the answer must say that.
    let hasSpecs = false;
    try {
      const { data: attrRows } = await supabase
        .from('product_attributes')
        .select('id')
        .eq('product_id', row.id)
        .limit(1);
      hasSpecs = ((attrRows ?? []) as unknown[]).length > 0;
    } catch {
      hasSpecs = false;
    }

    const lines: string[] = [];
    lines.push(`⚖️ Pros and cons of ${row.name}:`);
    lines.push('');
    lines.push('Pros:');
    for (const pro of summary.pros) lines.push(`• ${pro}`);
    lines.push('');
    lines.push('Cons:');
    for (const con of summary.cons) lines.push(`• ${con}`);

    // Recorded signals, kept separate from the summary's own
    // pros/cons so the reader can tell what came from where.
    const signalLines: string[] = [];
    if (product) {
      if (product.history) {
        if (product.history.current <= product.history.lowest) {
          signalLines.push(
            `At its lowest recorded price (${formatPriceText(product.history.current, region)}).`
          );
        } else if (
          product.history.highest > product.history.lowest &&
          product.history.current >= product.history.highest * 0.95 &&
          product.history.current > product.history.lowest * 1.05
        ) {
          signalLines.push(
            `Near its highest recorded price (${formatPriceText(product.history.current, region)} vs a recorded high of ${formatPriceText(product.history.highest, region)}).`
          );
        }
      }
      if (product.reviewCount === 0) {
        signalLines.push('No reviews are recorded for this product.');
      } else {
        signalLines.push(
          `${product.reviewCount} review${product.reviewCount === 1 ? '' : 's'} recorded` +
            (product.reviewAvg !== null ? ` (average ${product.reviewAvg}/5)` : '') +
            '.'
        );
      }
      const savings = savingsText(product);
      if (savings) signalLines.push(`Comes with ${savings}.`);
    }
    if (signalLines.length > 0) {
      lines.push('');
      lines.push('From recorded data:');
      for (const s of signalLines) lines.push(`• ${s}`);
    }

    const unknown: string[] = [];
    if ((product?.reviewCount ?? 0) === 0) {
      unknown.push('real buyer experience (no reviews recorded)');
    }
    if (!hasSpecs) {
      unknown.push('battery life, RAM and similar qualities (no specifications recorded)');
    }
    if (unknown.length > 0) {
      lines.push('');
      lines.push(`What isn't known: ${unknown.join('; ')} — these cannot be assessed from recorded data, so no claim is made about them.`);
    }
    if (summary.freshnessNote) {
      lines.push('');
      lines.push(summary.freshnessNote);
    }
    lines.push('Open the product card below for the full summary and price history.');

    return {
      content: lines.join('\n'),
      metadata: {
        products: product ? [toCard(product)] : [],
        intent: 'pros_cons',
      },
    };
  } catch (err) {
    logger.error('prosConsAssistant: unexpected error', { error: String(err) });
    return {
      content: 'Sorry, I could not list pros and cons right now. Please try again.',
      metadata: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Coupon / cashback intent ("any coupon for MacBook?", "cashback?")
// ---------------------------------------------------------------------------

/** Validity label from the coupons table's valid_until — never
 *  invented: a row with no expiry says so, and expired rows never
 *  reach an answer (enrichProducts drops them; the merchant-wide
 *  path below filters them too). Live validity of the seeded
 *  SAVE10 / BESTBUY15 codes is therefore whatever the live table
 *  says at request time — if the 90-day seed window has lapsed,
 *  the answer honestly says no coupon is currently valid. */
function validityLabel(validUntil: string | null): string {
  if (!validUntil) return 'no expiry date recorded';
  const d = new Date(validUntil);
  if (Number.isNaN(d.getTime())) return 'no expiry date recorded';
  return `valid until ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`;
}

function couponLine(c: AssistantCoupon): string {
  const value =
    c.discountType === 'percentage' ? `${c.discountValue}% off` : `$${c.discountValue} off`;
  return `${c.code} (${value}, ${validityLabel(c.validUntil)})`;
}

/**
 * Answer coupon / cashback questions from the coupons +
 * cashback_offers tables — never inventing a code. With a named
 * product, the answer covers that product's best retailer (its
 * currently-valid coupons + its cashback offers). With no product
 * named, it lists the currently-valid merchant coupons (optionally
 * for the merchant named, e.g. "any Best Buy coupons?") and says
 * cashback needs a product name, because cashback offers are
 * per-product rows.
 */
export async function couponsAssistant(
  supabase: AnySupabaseClient,
  message: string,
  intent: ParsedSearchIntent,
  region: Region = FALLBACK_REGION
): Promise<AssistantAnswer> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url, confidence_score')
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop')
      .order('confidence_score', { ascending: false })
      .limit(50);

    if (error || !data) {
      return {
        content: 'Sorry, I could not check coupons right now. Please try again.',
        metadata: null,
      };
    }

    const matched = matchProductsByName(message, data as unknown as BasicProductRow[]);
    const lower = message.toLowerCase();
    const merchantSlug =
      lower.includes('best buy') || lower.includes('bestbuy')
        ? 'best-buy'
        : lower.includes('amazon')
          ? 'amazon'
          : null;

    if (matched.length > 0) {
      const products = await enrichProducts(supabase, matched.slice(0, 3));
      if (products.length === 0) {
        return {
          content:
            `I couldn't find a priced product matching that name, so I can't check its coupons — ` +
            `I only show coupons for products with a verified price. Try naming a product from the catalog.`,
          metadata: null,
        };
      }
      const lines: string[] = [];
      for (const p of products) {
        lines.push(
          `${p.name} — ${formatPriceText(p.price, region)} at ${p.bestRetailer.name} ` +
            `(${retailerDomain(p.bestRetailer, region)}).`
        );
        if (p.coupons.length > 0) {
          lines.push(`Coupons at ${p.bestRetailer.name}: ${p.coupons.map(couponLine).join('; ')}.`);
        } else {
          lines.push(`No currently-valid coupons at ${p.bestRetailer.name} for this product.`);
        }
        if (p.cashback.length > 0) {
          lines.push(
            `Cashback: ${p.cashback
              .map(
                (cb) =>
                  `${cb.title} (${cb.cashbackType === 'percentage' ? `${cb.cashbackValue}% cashback` : `$${cb.cashbackValue} cashback`})`
              )
              .join('; ')}.`
          );
        } else {
          lines.push('No cashback offer is currently listed for this product.');
        }
        lines.push('');
      }
      lines.push(
        "Coupon codes apply at the retailer's checkout, not inside SmartBuy. " +
          'Only currently-valid coupons from our coupons table are shown — expired codes are never listed.'
      );
      return {
        content: lines.join('\n').trim(),
        metadata: { products: products.map(toCard), intent: intent.intent },
      };
    }

    // No product named: merchant-wide coupons from the coupons table.
    const [couponRes, merchantRes] = await Promise.all([
      supabase
        .from('coupons')
        .select('code, merchant_id, discount_type, discount_value, valid_until')
        .eq('active', true)
        .limit(200),
      supabase.from('merchants').select('id, name, slug'),
    ]);
    const merchantById = new Map(
      ((merchantRes.data ?? []) as Array<{ id: string; name: string; slug: string }>).map((m) => [
        m.id,
        { name: m.name, slug: m.slug },
      ])
    );
    const now = Date.now();
    const valid = ((couponRes.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        const validUntil = row.valid_until as string | null;
        if (validUntil && new Date(validUntil).getTime() < now) return false;
        if (merchantSlug) {
          const merchant = merchantById.get(row.merchant_id as string);
          if (!merchant || merchant.slug !== merchantSlug) return false;
        }
        return true;
      })
      .map((row) => ({
        code: row.code as string,
        discountType: row.discount_type as string,
        discountValue: parseNum(row.discount_value) ?? 0,
        validUntil: (row.valid_until as string | null) ?? null,
        merchantName: merchantById.get(row.merchant_id as string)?.name ?? 'Retailer',
      }));

    if (valid.length === 0) {
      const scope = merchantSlug
        ? ` for ${merchantById.size > 0 ? [...merchantById.values()].find((m) => m.slug === merchantSlug)?.name ?? merchantSlug : merchantSlug}`
        : '';
      return {
        content:
          `I don't see any currently-valid coupons${scope} right now. ` +
          `Coupons expire, so check the Deals page for the latest offers — or name a product and I'll check its coupons and cashback.`,
        metadata: null,
      };
    }

    const lines = ['Here are the currently-valid coupons I can see:', ''];
    for (const c of valid) {
      lines.push(`• ${couponLine(c)} — ${c.merchantName}.`);
    }
    lines.push('');
    lines.push(
      'Cashback offers are per product — name a product (e.g. "any cashback for MacBook Air 13?") and I will check its cashback.'
    );
    lines.push("Coupon codes apply at the retailer's checkout, not inside SmartBuy.");
    return {
      content: lines.join('\n'),
      metadata: { products: [], intent: intent.intent },
    };
  } catch (err) {
    logger.error('couponsAssistant: unexpected error', { error: String(err) });
    return {
      content: 'Sorry, I could not check coupons right now. Please try again.',
      metadata: null,
    };
  }
}

export async function dealsAssistant(
  supabase: AnySupabaseClient,
  region: Region = FALLBACK_REGION
): Promise<AssistantAnswer> {
  try {
    const { data, error } = await supabase
      .from('deals')
      .select('id, title, deal_type, discount_type, discount_value, end_at, coupon_code, product_id')
      .eq('active', true)
      .is('deleted_at', null)
      .gte('end_at', new Date().toISOString())
      .order('discount_value', { ascending: false })
      .limit(10);

    if (error || !data || data.length === 0) {
      return {
        content:
          "I don't see any active deals right now. Check the Deals page for the latest offers, or set up a price alert to be notified when prices drop!",
        metadata: null,
      };
    }

    const dealRows = data as Array<Record<string, unknown>>;
    const productIds = dealRows.map((d) => d.product_id as string | null).filter(Boolean) as string[];
    const { data: productRows } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, image_url, confidence_score')
      .in('id', productIds)
      .is('deleted_at', null)
      .neq('slug', 'sample-laptop');

    const enriched = await enrichProducts(supabase, (productRows ?? []) as unknown as BasicProductRow[]);
    const byId = new Map(enriched.map((p) => [p.id, p]));

    // Only deals whose product survived the priced / non-demo
    // filter are listed — a deal on a demo or unpriced product is
    // not a recommendation.
    const listed: Array<{ deal: Record<string, unknown>; product: EnrichedProduct }> = [];
    for (const deal of dealRows) {
      const product = byId.get(deal.product_id as string);
      if (product) listed.push({ deal, product });
      if (listed.length >= 4) break;
    }

    if (listed.length === 0) {
      return {
        content:
          "I don't see any active deals on priced products right now. Check the Deals page for the latest offers, or set up a price alert to be notified when prices drop!",
        metadata: null,
      };
    }

    const lines = ["Here are today's best deals (verified prices only):", ''];
    for (const { deal, product } of listed) {
      const discount = `${deal.discount_value}${deal.discount_type === 'percentage' ? '%' : '$'}`;
      const coupon = deal.coupon_code ? ` (Code: ${deal.coupon_code})` : '';
      lines.push(
        `• ${deal.title as string} — ${discount} off${coupon} — ${product.name} at ` +
          `${formatPriceText(product.price, region)} from ${product.bestRetailer.name} ` +
          `(${retailerDomain(product.bestRetailer, region)}).`
      );
    }
    lines.push('');
    lines.push('Visit the Deals page for more offers and AI-ranked discounts!');

    return {
      content: lines.join('\n'),
      metadata: { products: listed.map(({ product }) => toCard(product)) },
    };
  } catch (err) {
    logger.error('dealsAssistant: unexpected error', { error: String(err) });
    return {
      content: 'Sorry, I could not find deals right now. Please try again.',
      metadata: null,
    };
  }
}
