/**
 * API v1 community deals endpoint.
 * GET  /api/v1/community-deals — approved community deals, net-score
 *        ranked, with computed Verified badges (see
 *        services/community-deals.ts — upvotes never verify a deal).
 * POST /api/v1/community-deals — submit a deal (auth required).
 *
 * Graceful degradation: if supabase/add-community-deals.sql has not
 * been run yet, the tables do not exist — GET returns
 * { deals: [], communityEnabled: false } (never a crash, never fake
 * deals) and POST returns 503 with an honest message.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  badRequest,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { isDealVerified, netScore, type CommunityDealRow, type MerchantPriceRow } from '@/services/community-deals';

// PostgREST reports a table missing from its schema cache as PGRST205
// (not Postgres 42P01) on the REST path, so both codes must count as
// "migration not run yet" — otherwise a missing table surfaces as a
// generic INTERNAL_ERROR instead of the honest enabled:false flag.
function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'community-deals' });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: deals, error } = await supabase
      .from('community_deals')
      .select(
        'id, user_id, author_name, product_id, product_name, merchant_id, merchant_name, price, deal_text, coupon_code, source_url, status, is_verified, created_at'
      )
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      if (isMissingTable(error)) {
        return apiSuccess([], 200, { communityEnabled: false });
      }
      return internalError('Failed to fetch community deals');
    }
    const rows = (deals ?? []) as CommunityDealRow[];
    if (rows.length === 0) return apiSuccess([], 200, { communityEnabled: true });

    const dealIds = rows.map((d) => d.id);
    const { data: votes } = await supabase
      .from('community_deal_votes')
      .select('deal_id, value')
      .in('deal_id', dealIds);
    const votesByDeal = new Map<string, Array<{ value: number }>>();
    for (const v of (votes ?? []) as Array<{ deal_id: string; value: number }>) {
      const list = votesByDeal.get(v.deal_id) ?? [];
      list.push({ value: v.value });
      votesByDeal.set(v.deal_id, list);
    }

    // One merchant_products lookup for every linked deal, for the
    // price-match verification — no per-deal queries.
    const linked = rows.filter((d) => d.product_id && d.merchant_id);
    let merchantPrices: MerchantPriceRow[] = [];
    if (linked.length > 0) {
      const productIds = [...new Set(linked.map((d) => d.product_id as string))];
      const { data: mp } = await supabase
        .from('merchant_products')
        .select('merchant_id, product_id, price')
        .in('product_id', productIds);
      merchantPrices = ((mp ?? []) as Array<{ merchant_id: string; product_id: string; price: number }>).map(
        (r) => ({ merchant_id: r.merchant_id, product_id: r.product_id, price: Number(r.price) })
      );
    }

    const enriched = rows.map((d) => ({
      ...d,
      netScore: netScore(votesByDeal.get(d.id) ?? []),
      verified: isDealVerified(d, merchantPrices),
    }));
    enriched.sort((a, b) => b.netScore - a.netScore || b.created_at.localeCompare(a.created_at));
    return apiSuccess(enriched, 200, { communityEnabled: true });
  } catch {
    return internalError('Failed to fetch community deals');
  }
}

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'community-deals' });

  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json().catch(() => null);
    const productName = typeof body?.productName === 'string' ? body.productName.trim() : '';
    const productId = typeof body?.productId === 'string' ? body.productId.trim() : null;
    const merchantName = typeof body?.merchantName === 'string' ? body.merchantName.trim() : null;
    const price =
      typeof body?.price === 'number' && Number.isFinite(body.price) && body.price > 0 ? body.price : null;
    const dealText = typeof body?.dealText === 'string' ? body.dealText.trim() : null;
    const couponCode = typeof body?.couponCode === 'string' ? body.couponCode.trim() : null;
    const sourceUrl = typeof body?.sourceUrl === 'string' ? body.sourceUrl.trim() : null;

    if (!productName && !productId) {
      return validationError('A product name (or a catalog product) is required.');
    }
    if (sourceUrl) {
      try {
        const u = new URL(sourceUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      } catch {
        return validationError('sourceUrl must be a valid http(s) URL.');
      }
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('community_deals')
      .insert({
        user_id: auth.userId,
        product_id: productId,
        product_name: productName || 'Unnamed product',
        merchant_name: merchantName,
        price,
        deal_text: dealText,
        coupon_code: couponCode,
        source_url: sourceUrl,
        status: 'approved',
      })
      .select('id, product_name, merchant_name, price, deal_text, coupon_code, source_url, created_at')
      .single();
    if (error) {
      if (isMissingTable(error)) {
        return serviceUnavailable('Community deals are not set up yet — the owner still needs to run supabase/add-community-deals.sql once.');
      }
      return internalError('Failed to submit community deal');
    }
    return apiSuccess(data, 201, { communityEnabled: true });
  } catch {
    return internalError('Failed to submit community deal');
  }
}
