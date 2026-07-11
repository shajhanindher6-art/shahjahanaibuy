/**
 * API v1 AI search endpoint.
 * POST /api/v1/ai-search — natural-language product search with AI scoring.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import {
  getCachedAISearch,
  recordSearch,
  type AISearchOptions,
} from '@/services/ai-search';
import type { SearchFilters } from '@/types/ai';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'ai-search' });

  try {
    const body = await request.json();
    const { query, filters, page, pageSize } = body ?? {};

    if (typeof query !== 'string' || query.trim() === '') {
      return badRequest('query is required');
    }

    const options: AISearchOptions = {
      query,
      filters: filters as SearchFilters | undefined,
      page: typeof page === 'number' ? page : undefined,
      pageSize: typeof pageSize === 'number' ? pageSize : undefined,
    };

    const supabase = await createSupabaseServerClient();
    const result = await getCachedAISearch(supabase, options);

    // Best-effort: record search history for authenticated users.
    const auth = await requireAuth(request);
    if (!('error' in auth)) {
      void recordSearch(supabase, auth.userId, query, options.filters ?? null, result.total);
    }

    return apiSuccess(result.results, 200, {
      total: result.total,
      parsedIntent: result.parsedIntent,
    });
  } catch {
    return internalError('Failed to perform AI search');
  }
}
