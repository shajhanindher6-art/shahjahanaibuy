/**
 * API v1 AI search endpoint.
 * POST /api/v1/ai-search — natural-language product search with AI scoring.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError, rateLimited } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import {
  getCachedAISearch,
  recordSearch,
  AI_SEARCH_SORT_KEYS,
  type AISearchOptions,
  type AISearchSortKey,
} from '@/services/ai-search';
// Section 19, Phase 1 (§12 #1, #4, #7, #13) — the web leg runs
// through the AI engine (SerpAPI provider + daily budget); the
// anon cap and per-user quota come from the engine's usage module.
import { getAiEngine } from '@/services/ai-engine';
import {
  AI_SEARCH_ANON_PER_MIN,
  checkAiUserQuotaAsync,
} from '@/services/ai-engine/usage';
import { type WebSearchOutcome, type WebSearchResult } from '@/services/external-search';
import type { SearchFilters } from '@/types/ai';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'ai-search' });
  const startedAt = Date.now();
  // Rate limit: 10 requests/min per IP (see docs/rate-limits.md).
  // Section 19, Phase 1 (§12 #7): tightened from 20/min — this
  // route can spend SerpAPI free quota (~100–250 searches/month),
  // and the 24h/7d cache is per-query, so 20 distinct queries/min
  // could exhaust a month's quota in minutes. The global daily
  // SerpAPI budget (5 live calls/day) is the second line of defence.
  const limited = await rateLimitResponse(`ai-search:${getClientIp(request)}`, AI_SEARCH_ANON_PER_MIN);
  if (limited) return limited;

  // Section 19, Phase 1 (§12 #13) — per-user AI quota for
  // signed-in users (300 AI calls/day across AI routes, in-memory).
  // Anonymous users keep the per-IP limit above as their floor.
  // Resolved here (not after the search) so an over-quota user is
  // stopped before any work — including provider quota — is spent.
  // The same `auth` is reused below for recordSearch.
  const auth = await requireAuth(request);
  if (!('error' in auth)) {
    const quota = await checkAiUserQuotaAsync(auth.userId);
    if (!quota.allowed) {
      return rateLimited('Daily AI usage limit reached. Try again tomorrow.', {
        resetAt: quota.resetAt,
      });
    }
  }

  try {
    const body = await request.json();
    const { query, url, filters, page, pageSize, includeWeb, sort } = body ?? {};

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
      // Section 14, Chunk 4 — B1: the page used to send pageSize
      // only, so the service always ran page 1 and the page sliced
      // in memory. Page, size and sort are passed through now, and
      // meta reports the effective page + totalPages, so the page
      // and the API agree on page / pageSize / total.
      page: typeof page === 'number' ? page : undefined,
      pageSize: typeof pageSize === 'number' ? pageSize : undefined,
      sort: (AI_SEARCH_SORT_KEYS as string[]).includes(sort)
        ? (sort as AISearchSortKey)
        : undefined,
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
    // Section 18, item 34 — pass `fromCache` through: the old code
    // discarded it, so up-to-7-day-old cached prices were shown
    // under a "Live web results" heading. `webFetchedAt` is the
    // cache entry's timestamp (or the live fetch time), never
    // invented — null when the age is unknown.
    let webFromCache = false;
    let webFetchedAt: string | null = null;
    // Section 19, Phase 1 (§12 #7) — true when the daily SerpAPI
    // budget was exhausted, so the web leg was skipped and only
    // catalog results are served. The search page reads this to
    // show "Web results unavailable today — showing catalog
    // results" instead of silently serving catalog-only.
    let webBudgetExhausted = false;
    const catalogEmpty = result.results.length === 0 && result.total === 0;
    if (catalogEmpty || includeWeb === true) {
      // Effective budget for the web filter: an explicit filter
      // wins, otherwise the parsed (currency-normalized USD)
      // budget. E.g. "under 20K PKR" passes 71 here, so SerpAPI
      // rows above $71 are dropped instead of showing $500+ phones.
      const effectiveBudget = options.filters?.budgetMax ?? result.parsedIntent.budget;
      // Section 19, Phase 1 (§12 #1, #4) — the web leg runs
      // through the AI engine's SerpAPI provider (fallback chain
      // + daily budget + usage/latency tracking live there). No
      // provider available (no key configured) throws
      // NoAiProviderAvailableError — caught here and answered with
      // the same disabled outcome the direct call used to return,
      // so the search behaves exactly as before without a key.
      let web: WebSearchOutcome;
      try {
        const invoked = await getAiEngine().invoke<WebSearchOutcome>('web-search', {
          supabase,
          query: searchQuery,
          limit: typeof pageSize === 'number' ? pageSize : 10,
          maxPriceUsd: effectiveBudget,
        });
        web = invoked.value;
      } catch {
        web = {
          results: [],
          fromCache: false,
          disabled: true,
          fetchedAt: null,
          budgetExhausted: false,
        };
      }
      webResults = web.results;
      webFromCache = web.fromCache;
      webFetchedAt = web.fetchedAt;
      webBudgetExhausted = web.budgetExhausted === true;
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
    if (!('error' in auth)) {
      void recordSearch(supabase, auth.userId, searchQuery, options.filters ?? null, seenTotal);
    }

    return apiSuccess(result.results, 200, {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      parsedIntent: result.parsedIntent,
      source: webSource,
      webResults,
      // Section 18, item 34 — whether the web results came from
      // cache, and when they were fetched (see above).
      webFromCache,
      webFetchedAt,
      // Section 19, Phase 1 (§12 #7) — the honest label for the
      // catalog fallback when the daily SerpAPI budget is spent.
      webBudgetExhausted,
      // B10: the resolved "X vs Y" pair for the search page's
      // "Compare these two" CTA — [] when the query had no `vs`
      // or a side could not be resolved.
      compareProducts: result.compareProducts ?? [],
      // Section 15, B10: the Levenshtein-corrected spelling (and
      // whether the returned results are for it, not the typed
      // query) — the page offers it as "Did you mean: …?" for
      // zero AND few results, and labels fuzzy-corrected results
      // honestly. Null when no correction exists.
      didYouMean: result.didYouMean ?? null,
      fuzzyCorrected: result.fuzzyCorrected ?? false,
    });
  } catch (err) {
    logApiError(err, { request, route: 'ai-search', status: 500, startedAt });
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
