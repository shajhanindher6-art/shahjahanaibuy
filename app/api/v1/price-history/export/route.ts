/**
 * API v1 per-product price-history export endpoint (Section 16, E10).
 * GET /api/v1/price-history/export?product=<slug|id>&format=csv|json —
 * downloadable recorded history rows for ONE product.
 *
 * The existing export (app/api/v1/price-index/export/route.ts) is
 * index-level only, not per-product history. Same fail-open
 * honesty: an unknown product is a 404; a product with no
 * recorded history returns headers-only CSV / an empty-rows JSON
 * with a note, never a fabricated row. Rows are oldest-first,
 * exactly as recorded.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { badRequest, internalError, notFound } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logger } from '@/lib/config/logger';
import { getPriceHistory } from '@/services/price-history';
import { getProductById, getProductBySlug } from '@/services/products';
import {
  priceHistoryExportFileName,
  priceHistoryRowsToCsv,
  priceHistoryRowsToJson,
  type PriceHistoryExportRow,
} from '@/lib/price-history-export';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Section 19, item 96: a throw used to yield an unlogged Next 500.
  // The whole handler is wrapped so failures return the generic
  // error envelope instead.
  try {
    logApiRequest(request, { endpoint: 'price-history-export' });
    const limited = await rateLimitResponse(`price-history-export:${getClientIp(request)}`, 30);
    if (limited) return limited;

    const format = (request.nextUrl.searchParams.get('format') ?? 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'json') {
      return badRequest('format must be csv or json');
    }
    const productParam = request.nextUrl.searchParams.get('product');
    if (!productParam || productParam.trim().length === 0) {
      return badRequest('product is required (a product slug or id)');
    }

    const supabase = await createSupabaseServerClient();
    const product =
      (await getProductBySlug(supabase, productParam.trim())) ??
      (await getProductById(supabase, productParam.trim()));
    if (!product) {
      return notFound('Product not found');
    }

    const result = await getPriceHistory(supabase, product.id, { limit: 500 });
    const rows: PriceHistoryExportRow[] = [...result.history]
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())
      .map((h) => ({
        productSlug: product.slug,
        productName: product.name,
        price: h.price,
        currency: h.currency,
        availability: h.availability,
        recordedAt: h.recordedAt,
      }));

    const fileName = priceHistoryExportFileName(product.slug, format);
    if (format === 'json') {
      return new NextResponse(priceHistoryRowsToJson(product, rows), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${fileName}"`,
        },
      });
    }
    return new NextResponse(priceHistoryRowsToCsv(rows), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    logApiError(err, { request, route: 'price-history.export', status: 500 });
    logger.error('price-history-export: unexpected error', {
      error: err instanceof Error ? err.message : 'unknown',
    });
    return internalError('Price history export failed');
  }
}
