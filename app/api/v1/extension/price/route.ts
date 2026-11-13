/**
 * API v1 extension price endpoint.
 * GET /api/v1/extension/price?slug=macbook-air-13
 * GET /api/v1/extension/price?q=macbook%20air
 * GET /api/v1/extension/price?slug=macbook-air-13&country=PK
 *
 * Public, no-auth endpoint for the SmartBuy browser extension's
 * better-price banner and background price-drop sync. Returns the
 * cheapest in-stock merchant listings for one catalog product —
 * real merchant_products rows only, never invented prices.
 * Responses are capped (max 5 offers) and contain only public
 * price fields — never service-role data or user-private data.
 *
 * Section 15, A12: the response meta also carries `storeLinks` —
 * search links (lib/stores.ts builders) for the same product name,
 * so the extension banner can show "also search on" links for
 * stores that have no priced row. These are links to each store's
 * OWN search results, never a SmartBuy price, deal, or stock claim.
 * An optional `country` (ISO 3166-1 alpha-2) picks that country's
 * local stores first; without one, the global fallback plus the
 * flagship store of each newly covered local merchant (Daraz PK,
 * PriceOye PK, Noon AE, Jumia NG, Flipkart IN) is returned.
 * Stores already shown as priced offers (Amazon / Best Buy) are
 * excluded from the links, matching the product-page rule that the
 * same merchant never appears twice.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { buildExtensionStoreLinks } from '@/lib/extension-store-links';
import {
  findPublicProductByName,
  findPublicProductBySlug,
} from '@/lib/public-products';

import { logApiError } from '@/lib/api/error-logging';
import { getFreshnessStatus } from '@/lib/price-freshness';

/**
 * Final 100% — F-P2-21: the basis label for a `compareAtPrice`
 * in this response. A compare-at price is a merchant-stated list
 * price that was NEVER observed in recorded history — a machine
 * consumer must never read it as a verified saving or a former
 * selling price. Labelled on every offer that carries one.
 *
 * Module-local on purpose (not exported): Next.js route modules
 * may only export handlers/config — an exported const breaks the
 * generated `.next/types` route-type check (TS2344).
 */
const EXTENSION_COMPARE_AT_PRICE_BASIS =
  'merchant-stated list price — never observed in recorded history';

/** Basis label for a `price` in this response: a recorded merchant price, not a live check. */
const EXTENSION_PRICE_BASIS = 'recorded merchant price';
interface MerchantProductRow {
  price: number;
  compare_at_price: number | null;
  url: string | null;
  in_stock: boolean;
  availability: string;
  products: { name: string; slug: string } | null;
  merchants: { name: string } | null;
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'extension/price' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`extension.price:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const params = request.nextUrl.searchParams;
    const slug = (params.get('slug') ?? '').trim();
    const q = (params.get('q') ?? '').trim();
    const countryRaw = (params.get('country') ?? '').trim();
    // Optional 2-letter country code; anything else is ignored
    // (the global + flagship fallback below) rather than 400 —
    // the extension may not know the shopper's country.
    const country = /^[A-Za-z]{2}$/.test(countryRaw) ? countryRaw.toUpperCase() : null;
    if (!slug && !q) return badRequest('slug or q is required');

    const supabase = await createSupabaseServerClient();

    // Resolve the product first (by slug, or by name match for q).
    // Section 18, item 16: the shared public-product helper
    // filters deleted_at IS NULL + status = 'published' (42703
    // retry when migration 045 is unapplied), so a soft-deleted
    // or pending row can never leak through this public route.
    let productId: string | null = null;
    let productName: string | null = null;
    let productSlug: string | null = null;
    // Final 100% — F-P2-21: the product's recorded freshness
    // rides into meta so machine consumers can judge staleness
    // (null = no check date recorded, never "fresh").
    let productDataFreshness: string | null = null;
    const resolved = slug
      ? await findPublicProductBySlug(supabase, slug)
      : await findPublicProductByName(supabase, q);
    if (resolved) {
      productId = resolved.id;
      productName = resolved.name;
      productSlug = resolved.slug;
      productDataFreshness = resolved.dataFreshness ?? null;
    }
    if (!productId) return apiSuccess([], 200, { product: null, note: 'No catalog product matches.', storeLinks: [] });

    const { data, error } = await supabase
      .from('merchant_products')
      .select('price, compare_at_price, url, in_stock, availability, products(name, slug), merchants(name)')
      .eq('product_id', productId)
      .order('price', { ascending: true })
      .limit(20);
    if (error || !data) {
      return apiSuccess([], 200, {
        product: { name: productName, slug: productSlug, priceFreshness: { status: getFreshnessStatus(productDataFreshness).status, lastCheckedAt: productDataFreshness } },
        // Store links do not depend on merchant rows, so they are
        // still useful when the offers query fails.
        storeLinks: productName ? buildExtensionStoreLinks(productName, country) : [],
      });
    }

    // Same in-stock rule as the product page: in_stock true OR
    // availability 'in_stock'. Cheapest first, capped at 5.
    // Final 100% — F-P2-21: every offer labels its numbers.
    // `price` is a recorded merchant price (basis + staleness in
    // meta.product.priceFreshness); `compareAtPrice` is a
    // merchant-stated list price, never observed in recorded
    // history — it travels with its basis + the "vs list price"
    // label, never raw, so a machine consumer cannot mistake it
    // for a verified former price.
    const priceFreshness = getFreshnessStatus(productDataFreshness);
    const offers = (data as unknown as MerchantProductRow[])
      .filter((r) => r.in_stock === true || r.availability === 'in_stock')
      .slice(0, 5)
      .map((r) => ({
        merchant: r.merchants?.name ?? null,
        price: Number(r.price),
        priceBasis: EXTENSION_PRICE_BASIS,
        compareAtPrice: r.compare_at_price !== null ? Number(r.compare_at_price) : null,
        compareAtPriceLabel: r.compare_at_price !== null ? 'vs list price' : null,
        compareAtPriceBasis: r.compare_at_price !== null ? EXTENSION_COMPARE_AT_PRICE_BASIS : null,
        url: r.url,
        inStock: true,
      }));

    // Section 15, A12: store search links for the banner's
    // "also search on" row. Priced-offer merchants are excluded
    // from the links so no merchant appears twice.
    const storeLinks = productName
      ? buildExtensionStoreLinks(
          productName,
          country,
          offers.map((o) => o.merchant).filter((m): m is string => m !== null)
        )
      : [];

    return apiSuccess(offers, 200, { product: { name: productName, slug: productSlug, priceFreshness: { status: priceFreshness.status, lastCheckedAt: productDataFreshness } }, storeLinks });
  } catch (err) {
    logApiError(err, { request, route: 'extension.price', status: 500 });
    return internalError('Failed to fetch extension price');
  }
}
