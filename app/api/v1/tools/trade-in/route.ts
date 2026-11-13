/**
 * API v1 Trade-in & Second-hand Finder — GET /api/v1/tools/trade-in.
 *
 * Public read of the real trade-in program directory
 * (`trade_in_programs`, lib/trade-in-finder.ts). The directory
 * starts EMPTY and no program is ever invented — until an admin
 * records a real program, the response honestly reports zero
 * programs. Optional `?slug=` links one product's Resale Predictor
 * value (REUSED from services/resale-predictor.ts, labeled
 * "Simulated — not a resale quote"). Optional `?category=` filters
 * the directory.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCachedProductBySlug } from '@/services/products';
import { getLatestPrice } from '@/services/price-history';
import {
  getTradeInPrograms,
  getResalePredictionForProduct,
  buildTradeInSummary,
  TRADE_IN_EMPTY_MESSAGE,
} from '@/lib/trade-in-finder';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'tools.trade-in' });

  const limited = await rateLimitResponse(`tools-trade-in:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const category = searchParams.get('category') ?? undefined;
    const slug = searchParams.get('slug') ?? undefined;

    const supabase = await createSupabaseServerClient();
    const directory = await getTradeInPrograms(supabase, { category });

    let product: { slug: string; name: string } | null = null;
    let resale = null as Awaited<ReturnType<typeof getResalePredictionForProduct>>;
    if (slug) {
      const found = await getCachedProductBySlug(supabase, slug);
      if (found) {
        product = { slug: found.slug, name: found.name };
        const latest = await getLatestPrice(supabase, found.id);
        resale = await getResalePredictionForProduct(
          supabase,
          found.id,
          latest != null ? Number(latest.price) : null
        );
      }
    }

    const summary = buildTradeInSummary(directory, resale, product?.slug ?? null);

    return apiSuccess({
      programs: directory.programs,
      directoryAvailable: directory.directoryAvailable,
      totalPrograms: directory.totalPrograms,
      verifiedPrograms: directory.verifiedPrograms,
      emptyMessage: directory.totalPrograms === 0 ? TRADE_IN_EMPTY_MESSAGE : null,
      product,
      resale: summary.resale,
      headline: summary.headline,
      refurbishedNote:
        'Certified refurbished listings are not invented: no refurbished inventory is recorded. Check the product page — every retailer link there is a real link to that retailer, where certified refurbished offers appear when the retailer has them.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'tools.trade-in', status: 500 });
    return internalError('Failed to load the trade-in finder');
  }
}
