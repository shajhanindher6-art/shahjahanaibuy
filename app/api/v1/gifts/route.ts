/**
 * API v1 gifts endpoint.
 * POST /api/v1/gifts — Smart Gift & Occasion Recommender.
 *
 * Body: { occasion?: string, budgetText?: string, country?: string,
 *         interests?: string[] | string }
 *
 * - Budget text is parsed by the existing currency parser (K / lakh /
 *   crore + currency codes, e.g. "under 20K PKR") and converted to
 *   USD; the budget is then a HARD filter in the engine.
 * - Country reuses the region system: prices are shown converted
 *   (≈ + small USD) and the response includes that country's local /
 *   global store search links. Shipping is NOT computed — no live
 *   shipping costs exist, so the response carries only an honest
 *   note that shipping/taxes are confirmed at the retailer's
 *   checkout.
 * - Picks are deterministic (no LLM, no key): see
 *   services/gift-finder.ts. Occasion is display context only.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { parseBudgetFromQuery } from '@/services/currency';
import { resolveRegion, convertUsd } from '@/lib/region';
import { getStoresForCountry, buildStoreSearchUrl } from '@/lib/stores';
import { getCoupons } from '@/services/commerce';
import { buildGeoAffiliateUrl, isGeoAffiliateEnabled } from '@/services/affiliate-geo';
import { bestCoupon, couponValueLabel, type DealCoupon } from '@/lib/deal-math';
import { findGiftPicks, SHIPPING_NOTE, type GiftCandidate } from '@/services/gift-finder';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'gifts' });

  // Public gift picks are read-only compute; cap per IP so one
  // client cannot flood them. In-memory bucket (per instance).
  const limited = rateLimitResponse(`gifts:${getClientIp(request)}`, 30);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const occasion = typeof body?.occasion === 'string' ? body.occasion.trim() : '';
    const budgetText = typeof body?.budgetText === 'string' ? body.budgetText.trim() : '';
    const country = typeof body?.country === 'string' ? body.country.trim().toUpperCase() : '';
    const interestsRaw = body?.interests;
    const interests: string[] = Array.isArray(interestsRaw)
      ? interestsRaw.filter((s): s is string => typeof s === 'string')
      : typeof interestsRaw === 'string'
        ? interestsRaw.split(',')
        : [];

    const parsedBudget = budgetText ? parseBudgetFromQuery(`under ${budgetText}`) : null;
    const budgetUsd = parsedBudget ? parsedBudget.budgetUsd : null;
    if (budgetText && !parsedBudget) {
      return badRequest('Could not understand the budget. Try e.g. "under 20K PKR" or "under $500".');
    }

    const region = resolveRegion(country || null);
    const supabase = await createSupabaseServerClient();

    const { data: products } = await supabase
      .from('products')
      .select('id, name, slug, brand, category, description')
      .neq('slug', 'sample-laptop')
      .limit(100);
    const productRows = (products ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      brand: string | null;
      category: string | null;
      description: string | null;
    }>;
    if (productRows.length === 0) {
      return apiSuccess([], 200, { region, budgetUsd, shippingNote: SHIPPING_NOTE, stores: [] });
    }

    const productIds = productRows.map((p) => p.id);
    const { data: listings } = await supabase
      .from('merchant_products')
      .select('product_id, merchant_id, price, compare_at_price, in_stock, availability, merchants(name)')
      .in('product_id', productIds)
      .order('price', { ascending: true })
      .limit(500);
    const bestByProduct = new Map<
      string,
      { price: number; compareAt: number | null; merchantId: string; merchantName: string | null }
    >();
    // Supabase types the joined merchants relation as an array; the
    // query returns a single object per row, so normalize both.
    const listingRows = (listings ?? []) as unknown as Array<{
      product_id: string;
      merchant_id: string;
      price: number;
      compare_at_price: number | null;
      in_stock: boolean;
      availability: string;
      merchants: { name: string } | Array<{ name: string }> | null;
    }>;
    for (const row of listingRows) {
      if (!(row.in_stock === true || row.availability === 'in_stock')) continue;
      if (!bestByProduct.has(row.product_id)) {
        const merchant = Array.isArray(row.merchants) ? row.merchants[0] : row.merchants;
        bestByProduct.set(row.product_id, {
          price: Number(row.price),
          compareAt: row.compare_at_price !== null ? Number(row.compare_at_price) : null,
          merchantId: row.merchant_id,
          merchantName: merchant?.name ?? null,
        });
      }
    }

    const coupons = await getCoupons(supabase, { active: true, limit: 200 });
    const bestByMerchant = new Map<string, DealCoupon>();
    for (const c of coupons) {
      if (!c.merchantId) continue;
      const list = coupons.filter((x) => x.merchantId === c.merchantId);
      const best = bestCoupon(list as DealCoupon[]);
      if (best) bestByMerchant.set(c.merchantId, best);
    }

    const candidates: GiftCandidate[] = productRows.map((p) => {
      const best = bestByProduct.get(p.id);
      const coupon = best ? bestByMerchant.get(best.merchantId) : undefined;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        category: p.category,
        description: p.description,
        bestPriceUsd: best ? best.price : null,
        compareAtUsd: best ? best.compareAt : null,
        merchantName: best ? best.merchantName : null,
        couponLabel: coupon ? `${coupon.code} (${couponValueLabel(coupon)})` : null,
      };
    });

    const picks = findGiftPicks(candidates, { budgetUsd, interests });
    const stores = getStoresForCountry(region.code);

    // Per-pick store search links (the priced merchant link lives on
    // the product page; here we give the directory links).
    // Step B: the same geo affiliate transform as the product page,
    // keyed to this response's own region (the visitor's stated
    // region for the gift search). ENV-GATED: with nothing
    // configured the URLs come back unchanged.
    const enriched = picks.map((pick) => ({
      ...pick,
      priceInRegion: pick.bestPriceUsd !== null ? convertUsd(pick.bestPriceUsd, region.currency) : null,
      regionCurrency: region.currency,
      storeLinks: stores.stores.map((s) => ({
        name: s.name,
        country: s.countryCode,
        searchUrl: buildGeoAffiliateUrl(buildStoreSearchUrl(s, pick.name), region.code),
      })),
    }));

    return apiSuccess(enriched, 200, {
      occasion: occasion || null,
      region: { countryCode: region.code, country: region.name, currency: region.currency },
      budgetUsd,
      shippingNote: SHIPPING_NOTE,
      storeKind: stores.kind,
      affiliateEnabled: isGeoAffiliateEnabled(),
    });
  } catch {
    return internalError('Gift recommendations failed');
  }
}
