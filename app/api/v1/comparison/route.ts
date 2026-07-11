/**
 * API v1 product comparison endpoint.
 * POST /api/v1/comparison — compare 2–5 products across retailers with AI summary.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getCachedComparison } from '@/services/ai-comparison';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'comparison' });

  try {
    const body = await request.json();
    const { productIds } = body ?? {};

    if (
      !Array.isArray(productIds) ||
      productIds.length < 2 ||
      productIds.length > 5 ||
      !productIds.every((id) => typeof id === 'string')
    ) {
      return badRequest('productIds must be an array of 2 to 5 product IDs');
    }

    const supabase = await createSupabaseServerClient();
    const comparison = await getCachedComparison(supabase, productIds);

    if (!comparison) {
      return badRequest('Unable to compare the provided products');
    }

    return apiSuccess(comparison, 200);
  } catch {
    return internalError('Failed to generate product comparison');
  }
}
