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
    const { query, url, filters, page, pageSize } = body ?? {};

    const hasQuery = typeof query === 'string' && query.trim() !== '';
    const hasUrl = typeof url === 'string' && url.trim() !== '';

    if (!hasQuery && !hasUrl) {
      return badRequest('query or url is required');
    }

    const searchQuery = hasQuery
      ? query.trim()
      : extractSearchFromUrl(url.trim());

    const options: AISearchOptions = {
      query: searchQuery,
      filters: filters as SearchFilters | undefined,
      page: typeof page === 'number' ? page : undefined,
      pageSize: typeof pageSize === 'number' ? pageSize : undefined,
    };

    const supabase = await createSupabaseServerClient();
    const result = await getCachedAISearch(supabase, options);

    // Best-effort: record search history for authenticated users.
    const auth = await requireAuth(request);
    if (!('error' in auth)) {
      void recordSearch(supabase, auth.userId, searchQuery, options.filters ?? null, result.total);
    }

    return apiSuccess(result.results, 200, {
      total: result.total,
      parsedIntent: result.parsedIntent,
    });
  } catch {
    return internalError('Failed to perform AI search');
  }
}

function extractSearchFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = pathParts[pathParts.length - 1] ?? '';
    const decoded = decodeURIComponent(lastSegment).replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
    return decoded.trim() || parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
