/**
 * API v1 category detail endpoint.
 * GET /api/v1/categories/[slug] — fetch a single category by slug.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { getCategoryBySlug } from '@/services/catalog';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'categories.detail', slug: params.slug });
  // Rate limit: 120 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`categories.slug:${getClientIp(request)}`, 120);
  if (limited) return limited;

  try {
    const supabase = await createSupabaseServerClient();
    const category = await getCategoryBySlug(supabase, params.slug);

    if (!category) {
      return notFound('Category not found');
    }

    return apiSuccess(category);
  } catch {
    return internalError('Failed to fetch category');
  }
}
