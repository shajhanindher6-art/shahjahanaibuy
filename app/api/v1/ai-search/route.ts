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
import { searchWebProducts, type WebSearchResult } from '@/services/external-search';
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

    // Web fallback: ONLY when the catalog returned nothing. Catalog
    // results are never mixed with web results, and web results are
    // returned separately in meta (not as catalog products), so the
    // UI can label them honestly as "Web result" with a retailer link.
    // When SERPAPI_API_KEY is unset, this is a no-op and the search
    // behaves exactly as before (catalog-only empty state).
    let webResults: WebSearchResult[] = [];
    let webSource: 'catalog' | 'web' | 'web-disabled' = 'catalog';
    if (result.results.length === 0 && result.total === 0) {
      const web = await searchWebProducts(
        supabase,
        searchQuery,
        typeof pageSize === 'number' ? pageSize : 10
      );
      webResults = web.results;
      webSource = web.disabled ? 'web-disabled' : web.results.length > 0 ? 'web' : 'catalog';
    }

    // Best-effort: record search history for authenticated users.
    // The count reflects what the user actually saw (catalog or web).
    const seenTotal = webSource === 'web' ? webResults.length : result.total;
    const auth = await requireAuth(request);
    if (!('error' in auth)) {
      void recordSearch(supabase, auth.userId, searchQuery, options.filters ?? null, seenTotal);
    }

    return apiSuccess(result.results, 200, {
      total: result.total,
      parsedIntent: result.parsedIntent,
      source: webSource,
      webResults,
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
