/**
 * API v1 Price Index export endpoint.
 * GET /api/v1/price-index/export?format=csv|json&category=&region= —
 * downloadable SmartBuy Price Index data. Same recorded-history
 * source and same fail-open honesty as GET /api/v1/price-index:
 * a database failure returns an empty CSV (headers only) / an
 * empty JSON index with a note, never a fabricated row.
 *
 * CSV columns: category, region, period_month, index_value,
 * products_used, points_used, status. Empty index_value means the
 * month had too few recorded prices — never an estimate.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { computePriceIndex, type PriceIndexEntry } from '@/lib/price-index';

// Live DB data must never be served from a stale edge cache.
export const dynamic = 'force-dynamic';

const CSV_HEADERS = 'category,region,period_month,index_value,products_used,points_used,status';

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(entries: PriceIndexEntry[]): string {
  const lines = entries.map((e) =>
    [
      csvEscape(e.category),
      csvEscape(e.region),
      e.periodMonth,
      e.indexValue === null ? '' : String(e.indexValue),
      String(e.productsUsed),
      String(e.pointsUsed),
      e.status,
    ].join(',')
  );
  return [CSV_HEADERS, ...lines].join('\n') + '\n';
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'price-index-export' });
  // Section 21–25, Stage J, J-P2-3 — wired: unexpected errors are logged via logApiError (error_log/Sentry) AND the honest empty response below is still returned.

  const limited = await rateLimitResponse(`price-index-export:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const format = (request.nextUrl.searchParams.get('format') ?? 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'json') {
    return badRequest('format must be csv or json');
  }

  const category = request.nextUrl.searchParams.get('category') || null;
  const regionParam = request.nextUrl.searchParams.get('region') || null;
  const region =
    regionParam && regionParam.trim().length > 0
      ? regionParam.trim().toUpperCase()
      : null;

  const note =
    'Monthly index from recorded price history only (base month = 100). Empty index_value means too few recorded prices that month — never an estimate.';

  try {
    const supabase = await createSupabaseServerClient();

    const [productsRes, retailersRes, historyRes] = await Promise.all([
      supabase.from('products').select('id, category').limit(500),
      supabase.from('retailers').select('id, country').limit(500),
      supabase
        .from('price_history')
        .select('product_id, retailer_id, price, recorded_at')
        .order('recorded_at', { ascending: true })
        .limit(5000),
    ]);

    if (productsRes.error || retailersRes.error || historyRes.error) {
      for (const [label, res] of [
        ['products', productsRes],
        ['retailers', retailersRes],
        ['price_history', historyRes],
      ] as const) {
        if (res.error) {
          logger.warn(`price-index-export: ${label} query failed`, {
            error: res.error.message,
          });
        }
      }
      if (format === 'csv') {
        return new NextResponse(`${CSV_HEADERS}\n`, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="smartbuy-price-index-${new Date().toISOString().slice(0, 10)}.csv"`,
          },
        });
      }
      return apiSuccess({
        entries: [],
        summaries: [],
        categories: [],
        regions: ['GLOBAL'],
        baseMonth: null,
        historyDays: 0,
        pointsUsed: 0,
        note: 'Price Index data is unavailable right now.',
        fetchedAt: new Date().toISOString(),
      });
    }

    const categoryByProduct = new Map<string, string | null>();
    for (const row of (productsRes.data ?? []) as Array<{ id: string; category: string | null }>) {
      categoryByProduct.set(row.id, row.category);
    }
    const countryByRetailer = new Map<string, string | null>();
    for (const row of (retailersRes.data ?? []) as Array<{ id: string; country: string | null }>) {
      countryByRetailer.set(row.id, row.country);
    }

    const index = computePriceIndex(
      ((historyRes.data ?? []) as Array<{
        product_id: string;
        retailer_id: string;
        price: number;
        recorded_at: string;
      }>).map((r) => ({
        productId: r.product_id,
        category: categoryByProduct.get(r.product_id) ?? null,
        region: countryByRetailer.get(r.retailer_id) ?? null,
        price: Number(r.price),
        recordedAt: r.recorded_at,
      })),
      { category, region }
    );

    if (format === 'csv') {
      return new NextResponse(toCsv(index.entries), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="smartbuy-price-index-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return apiSuccess({
      ...index,
      note,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('price-index-export: unexpected error', { error: String(err) });
    logApiError(err, { request, route: 'price-index-export', status: 500 });
    if (format === 'csv') {
      return new NextResponse(`${CSV_HEADERS}\n`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="smartbuy-price-index-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return apiSuccess({
      entries: [],
      summaries: [],
      categories: [],
      regions: ['GLOBAL'],
      baseMonth: null,
      historyDays: 0,
      pointsUsed: 0,
      note: 'Price Index data is unavailable right now.',
      fetchedAt: new Date().toISOString(),
    });
  }
}
