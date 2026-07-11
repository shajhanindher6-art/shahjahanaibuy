/**
 * API v1 brand detail endpoint.
 * GET /api/v1/brands/[slug] — fetch a single brand by slug.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getBrandBySlug } from '@/services/catalog';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'brands.detail', slug: params.slug });

  try {
    const supabase = await createSupabaseServerClient();
    const brand = await getBrandBySlug(supabase, params.slug);

    if (!brand) {
      return notFound('Brand not found');
    }

    return apiSuccess(brand);
  } catch {
    return internalError('Failed to fetch brand');
  }
}
