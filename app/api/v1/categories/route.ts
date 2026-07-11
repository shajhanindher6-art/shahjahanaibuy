/**
 * API v1 categories endpoint.
 * GET /api/v1/categories — return the active category tree.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, internalError } from '@/lib/api/responses';
import { logApiRequest } from '@/lib/api/middleware';
import { getCategoryTree } from '@/services/catalog';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'categories' });

  try {
    const supabase = await createSupabaseServerClient();
    const tree = await getCategoryTree(supabase);

    return apiSuccess(tree);
  } catch {
    return internalError('Failed to fetch category tree');
  }
}
