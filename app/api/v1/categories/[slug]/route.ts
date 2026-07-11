/**
 * API v1 category detail endpoint.
 * GET /api/v1/categories/[slug] — fetch a single category by slug.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, notFound, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getCategoryBySlug } from '@/services/catalog';

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  logApiRequest(request, { endpoint: 'categories.detail', slug: params.slug });

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
