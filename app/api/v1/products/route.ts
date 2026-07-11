/**
 * API v1 products endpoint.
 * GET /api/v1/products — list products (paginated, filtered).
 *
 * Supports `search`, `category`, `brand`, `page`, and `pageSize` query params.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getProducts, type ProductListOptions } from '@/services/products';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'products' });

  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)));
    const search = searchParams.get('search') ?? undefined;
    const category = searchParams.get('category') ?? undefined;
    const brand = searchParams.get('brand') ?? undefined;

    const supabase = await createSupabaseServerClient();
    const options: ProductListOptions = { page, pageSize, search, category, brand };
    const result = await getProducts(supabase, options);

    return apiSuccess(result.products, 200, {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    });
  } catch {
    return internalError('Failed to fetch products');
  }
}
