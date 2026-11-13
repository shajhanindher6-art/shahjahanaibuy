/**
 * API v1 scan endpoint.
 * POST /api/v1/scan — product scanner / visual search.
 *
 * Body: { keywords?: string, imageUrl?: string }
 *
 * Modes (see services/visual-search.ts for the honest design):
 * - "visual": SERPAPI_API_KEY is configured AND a public imageUrl was
 *   supplied — real SerpAPI google_lens matches, labelled "Visual match".
 * - "keyword-assisted": keywords supplied — the photo (if any) stays in
 *   the browser as a reference; matching runs through the existing
 *   catalog ai-search exactly like a text search, labelled
 *   "Keyword-assisted search from your photo".
 * - "needs-keywords": neither — 400, the UI must ask for keywords.
 *   The server NEVER guesses an identification from a photo alone.
 * Uploaded/captured photos are never sent here at all.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import { getCachedAISearch } from '@/services/ai-search';
import {
  decideScanMode,
  isVisualSearchConfigured,
  type VisualMatch,
} from '@/services/visual-search';
// Section 19, Phase 1 (§12 #1, #7) — the Lens leg runs through
// the AI engine; the anon cap + daily budget come from the
// engine's usage module.
import { getAiEngine } from '@/services/ai-engine';
import {
  SCAN_ANON_PER_MIN,
  isProviderBudgetExhausted,
} from '@/services/ai-engine/usage';

// Section 19, Phase 1 (§12 #10) — expensive inline AI work runs under
// maxDuration 60 (matching the 5 cron routes), not the platform default.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'scan' });
  const startedAt = Date.now();

  // A visual match spends a SerpAPI call, so the tightest cap here:
  // 5/min per IP (Section 19, Phase 1, §12 #7 — tightened from
  // 10/min). Redis-backed when Upstash is configured, in-memory fallback otherwise.
  const limited = await rateLimitResponse(`scan:${getClientIp(request)}`, SCAN_ANON_PER_MIN);
  if (limited) return limited;

  try {
    const body = await request.json().catch(() => null);
    const keywords = typeof body?.keywords === 'string' ? body.keywords.trim() : '';
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';

    const mode = decideScanMode({
      serpApiConfigured: isVisualSearchConfigured(),
      imageUrl: imageUrl || null,
      keywords: keywords || null,
    });

    if (mode === 'needs-keywords') {
      return badRequest(
        'Enter the product name or keywords. Without a configured visual-search key, a photo alone cannot identify a product.'
      );
    }

    if (mode === 'visual') {
      // Section 19, Phase 1 (§12 #7) — when the daily SerpAPI
      // budget is exhausted, Lens is skipped entirely and the
      // note says so honestly ("unavailable today"), instead of
      // pretending Lens searched and found nothing. The catalog
      // fallback below still serves when keywords exist.
      if (isProviderBudgetExhausted('serpapi')) {
        if (!keywords) {
          return apiSuccess([], 200, {
            mode: 'visual',
            visualDisabled: false,
            note: 'Web visual results are unavailable today (daily provider budget reached). Enter keywords to search the catalog instead.',
          });
        }
        const supabase = await createSupabaseServerClient();
        const result = await getCachedAISearch(supabase, { query: keywords, pageSize: 10 });
        return apiSuccess(result.results, 200, {
          mode: 'keyword-assisted',
          visualDisabled: false,
          note: 'Web visual results are unavailable today (daily provider budget reached) — showing keyword-assisted catalog matches for your photo.',
        });
      }
      // Section 19, Phase 1 (§12 #1) — Lens via the AI engine's
      // SerpAPI provider. An engine throw (no provider / circuit
      // open) degrades to [] and the honest fallback below — the
      // same behaviour the direct call's [] return used to give.
      let matches: VisualMatch[] = [];
      try {
        const invoked = await getAiEngine().invoke<VisualMatch[]>('visual-lens', { imageUrl });
        matches = invoked.value;
      } catch {
        matches = [];
      }
      if (matches.length > 0) {
        return apiSuccess(matches, 200, {
          mode: 'visual',
          visualDisabled: false,
          note: 'Visual match — identified from your image link via SerpAPI Lens.',
        });
      }
      // Lens failed or found nothing: fall back honestly, never fake.
      if (!keywords) {
        return apiSuccess([], 200, {
          mode: 'visual',
          visualDisabled: false,
          note: 'Visual search returned no matches for this image. Enter keywords to search the catalog instead.',
        });
      }
      const supabase = await createSupabaseServerClient();
      const result = await getCachedAISearch(supabase, { query: keywords, pageSize: 10 });
      return apiSuccess(result.results, 200, {
        mode: 'keyword-assisted',
        visualDisabled: false,
        note: 'Visual search found nothing, so these are keyword-assisted catalog matches for your photo.',
      });
    }

    // keyword-assisted: the normal path while no visual key is set.
    const supabase = await createSupabaseServerClient();
    const result = await getCachedAISearch(supabase, { query: keywords, pageSize: 10 });
    return apiSuccess(result.results, 200, {
      mode: 'keyword-assisted',
      visualDisabled: !isVisualSearchConfigured(),
      note: isVisualSearchConfigured()
        ? 'Keyword-assisted search from your photo.'
        : 'Visual identification is not configured on this site, so these are keyword-assisted catalog matches for your photo.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'scan', status: 500, startedAt });
    return internalError('Scan failed');
  }
}
