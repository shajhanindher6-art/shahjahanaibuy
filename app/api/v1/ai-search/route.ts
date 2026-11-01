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
    const { query, url, filters, page, pageSize, includeWeb } = body ?? {};

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

    // Web results: by default ONLY when the catalog returned
    // nothing (the fallback). When the caller explicitly asks for
    // live web prices (includeWeb: true — the search page's opt-in
    // toggle), web results are fetched ALONGSIDE catalog results
    // and returned separately in meta (never mixed into catalog
    // products), so the UI can label them honestly as "Web result"
    // with a retailer link. When SERPAPI_API_KEY is unset, this is
    // a no-op and the search behaves exactly as before. The toggle
    // is opt-in (not default) because every uncached web search
    // spends SerpAPI free quota (~100–250/month); the 24h/7d cache
    // in searchWebProducts means repeat queries cost nothing.
    let webResults: WebSearchResult[] = [];
    let webSource: 'catalog' | 'web' | 'web-disabled' = 'catalog';
    const catalogEmpty = result.results.length === 0 && result.total === 0;
    if (catalogEmpty || includeWeb === true) {
      // Effective budget for the web filter: an explicit filter
      // wins, otherwise the parsed (currency-normalized USD)
      // budget. E.g. "under 20K PKR" passes 71 here, so SerpAPI
      // rows above $71 are dropped instead of showing $500+ phones.
      const effectiveBudget = options.filters?.budgetMax ?? result.parsedIntent.budget;
      const web = await searchWebProducts(
        supabase,
        searchQuery,
        typeof pageSize === 'number' ? pageSize : 10,
        { maxPriceUsd: effectiveBudget }
      );
      webResults = web.results;
      webSource = web.disabled ? 'web-disabled' : web.results.length > 0 ? 'web' : 'catalog';
    }

    // Best-effort: record search history for authenticated users.
    // The count reflects what the user actually saw (catalog, web,
    // or both when live web was requested alongside the catalog).
    const seenTotal =
      webSource === 'web'
        ? catalogEmpty
          ? webResults.length
          : result.total + webResults.length
        : result.total;
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
