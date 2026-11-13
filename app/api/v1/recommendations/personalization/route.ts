/**
 * API v1 personalization opt-out endpoint (Section 19, Phase 4, §12 #43).
 * GET /api/v1/recommendations/personalization — { optedOut: boolean }.
 * PUT /api/v1/recommendations/personalization { optedOut: boolean } — set the toggle.
 *
 * When opted out, `getRecommendations` returns trending-only
 * results without reading any personal signal, and the dashboard
 * recommendations page labels them as such. Storage is
 * `agent_memory.preferences.personalizationOptOut`
 * (services/personalization-consent.ts) — see the limitation note
 * there: until migration 027 is applied, PUT answers 503 with an
 * honest "not available yet" instead of pretending the toggle saved.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  serviceUnavailable,
  validationError,
} from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import {
  getPersonalizationOptOut,
  setPersonalizationOptOut,
} from '@/services/personalization-consent';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations.personalization.get' });
  const limited = await rateLimitResponse(
    `recommendations.personalization:${getClientIp(request)}`,
    120
  );
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const supabase = await createSupabaseServerClient();
    const optedOut = await getPersonalizationOptOut(supabase, auth.userId);
    return apiSuccess({ optedOut }, 200);
  } catch (err) {
    logApiError(err, { request, route: 'recommendations.personalization.get', status: 500 });
    return internalError('Failed to read personalization setting');
  }
}

export async function PUT(request: NextRequest) {
  logApiRequest(request, { endpoint: 'recommendations.personalization.set' });
  const limited = await rateLimitResponse(
    `recommendations.personalization:${getClientIp(request)}`,
    30
  );
  if (limited) return limited;

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.optedOut !== 'boolean') {
      return validationError('optedOut must be a boolean.');
    }

    const supabase = await createSupabaseServerClient();
    const result = await setPersonalizationOptOut(supabase, auth.userId, body.optedOut);
    if (!result.ok) {
      return serviceUnavailable(
        'Personalization setting is not set up yet — run migration 027 in Supabase. Nothing was changed.'
      );
    }
    return apiSuccess({ optedOut: result.optedOut }, 200);
  } catch (err) {
    logApiError(err, { request, route: 'recommendations.personalization.set', status: 500 });
    return internalError('Failed to save personalization setting');
  }
}
