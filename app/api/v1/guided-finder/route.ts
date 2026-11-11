/**
 * API v1 guided-finder endpoint.
 * GET /api/v1/guided-finder — Guided Shopping Quiz results.
 *
 * Query: ?answers=<URI-encoded JSON> (the shareable quiz link), or
 * the same fields individually: ?useCase=laptop+for+work&budget=1000
 * &brand=Apple&mustHaves=Long+battery+life,Lightweight
 *
 * - Public, read-only compute; rate-limited per IP.
 * - Ranking is the ONE shared helper in services/guided-finder.ts
 *   (same as the Budget Finder page) — budget is a hard filter,
 *   unpriced products and the 'sample-laptop' demo row are never
 *   picks, and an empty result is returned honestly as [].
 * - Prices are verified merchant prices only (see the loader);
 *   nothing here is scraped, seeded, or invented.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import {
  answersToFinderInput,
  decodeQuizAnswers,
  loadGuidedCandidates,
  rankGuidedPicks,
  rankRelaxedGuidedPicks,
  GUIDED_BRANDS,
  GUIDED_MUST_HAVES,
  GUIDED_USE_CASES,
  type GuidedAnswers,
} from '@/services/guided-finder';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'guided-finder' });

  // Public quiz picks are read-only compute; cap per IP so one
  // client cannot flood them.
  const limited = await rateLimitResponse(`guided-finder:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const rawAnswers = searchParams.get('answers');

    let answers: GuidedAnswers | null = null;
    if (rawAnswers) {
      answers = decodeQuizAnswers(rawAnswers);
      if (!answers) {
        return badRequest('Could not understand the shared quiz answers in ?answers= — please retake the quiz.');
      }
    } else {
      const useCase = searchParams.get('useCase') ?? '';
      const budgetRaw = searchParams.get('budget');
      const brandRaw = searchParams.get('brand');
      const mustHavesRaw = searchParams.get('mustHaves');

      if (!useCase && !budgetRaw && !brandRaw && !mustHavesRaw) {
        return badRequest(
          'Provide ?answers= from the quiz, or at least one of useCase, budget, brand, mustHaves.'
        );
      }
      if (useCase && !GUIDED_USE_CASES.some((u) => u.value === useCase)) {
        return badRequest(`Unknown useCase "${useCase}".`);
      }
      let budgetUsd: number | null = null;
      if (budgetRaw) {
        budgetUsd = Number(budgetRaw);
        if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
          return badRequest(`"${budgetRaw}" is not a valid budget — enter a positive amount in USD.`);
        }
      }
      let brand: string | null = null;
      if (brandRaw) {
        if (!GUIDED_BRANDS.includes(brandRaw)) {
          return badRequest(`Unknown brand "${brandRaw}".`);
        }
        brand = brandRaw;
      }
      const mustHaves = mustHavesRaw
        ? mustHavesRaw.split(',').map((m) => m.trim()).filter(Boolean)
        : [];
      if (mustHaves.some((m) => !GUIDED_MUST_HAVES.includes(m))) {
        return badRequest('Unknown must-have — pick from the quiz options.');
      }
      answers = { useCase, budgetUsd, brand, mustHaves };
    }

    const input = answersToFinderInput(answers);
    const supabase = await createSupabaseServerClient();
    const candidates = await loadGuidedCandidates(supabase);
    const picks = rankGuidedPicks(candidates, { ...input, limit: 5 });
    // B1: nearest-miss fallback — only when the exact pass found
    // nothing. Relaxed picks are never mixed into `data`; the quiz
    // page renders them under the empty state, each labelled with
    // the must-haves it misses.
    const relaxed =
      picks.length === 0
        ? rankRelaxedGuidedPicks(candidates, { ...input, limit: 3 }, 3)
        : [];

    return apiSuccess(picks, 200, {
      answers,
      category: input.category,
      budgetUsd: input.budgetUsd,
      total: picks.length,
      catalogSize: candidates.length,
      relaxed,
      // Honest scope note: picks are priced products only; an empty
      // list means no priced product matched these answers, not a
      // missing catalog.
      pricedOnly: true,
    });
  } catch {
    return internalError('Guided finder failed');
  }
}
