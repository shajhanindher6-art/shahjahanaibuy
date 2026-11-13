/**
 * API v1 products endpoint.
 * GET /api/v1/products — list products (paginated, filtered).
 *
 * Supports `search`, `category`, `brand`, `page`, and `pageSize` query params.
 *
 * Sorting (Section 14, chunk 5): `sort=price-asc|price-desc|name-asc|
 * name-desc|newest` (default `newest`). Price sorts by the lowest
 * in-stock merchant price; unpriced products sort last. There is
 * deliberately no Deal Score sort: the score is 100/100 for every
 * product today, so it would sort nothing.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getProducts, type ProductListOptions } from '@/services/products';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

const SORT_VALUES = ['price-asc', 'price-desc', 'name-asc', 'name-desc', 'newest'] as const;
type SortParam = (typeof SORT_VALUES)[number];

function parseSort(raw: string | null): { sort: ProductListOptions['sort']; order: ProductListOptions['order'] } {
  const value: SortParam = (SORT_VALUES as readonly string[]).includes(raw ?? '')
    ? (raw as SortParam)
    : 'newest';
  switch (value) {
    case 'price-asc':
      return { sort: 'price', order: 'asc' };
    case 'price-desc':
      return { sort: 'price', order: 'desc' };
    case 'name-asc':
      return { sort: 'name', order: 'asc' };
    case 'name-desc':
      return { sort: 'name', order: 'desc' };
    default:
      return { sort: 'newest', order: 'desc' };
  }
}

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'products' });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`products:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));
    const search = searchParams.get('search') ?? undefined;
    const category = searchParams.get('category') ?? undefined;
    const brand = searchParams.get('brand') ?? undefined;
    const { sort, order } = parseSort(searchParams.get('sort'));

    const supabase = await createSupabaseServerClient();
    const options: ProductListOptions = { page, pageSize, search, category, brand, sort, order };
    const result = await getProducts(supabase, options);

    return apiSuccess(result.products, 200, {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  } catch (err) {
    logApiError(err, { request, route: 'products', status: 500 });
    return internalError('Failed to fetch products');
  }
}
