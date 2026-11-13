/**
 * API v1 analytics events endpoint.
 * POST /api/v1/analytics/events — track an analytics event.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth, rateLimitResponse, getClientIp } from '@/lib/api/middleware';

import { logApiError } from '@/lib/api/error-logging';
import { validateBody, analyticsEventSchema } from '@/lib/api/validation';
export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'analytics.events.track' });
  // Rate limit: 60 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`analytics.events:${getClientIp(request)}`, 60);
  if (limited) return limited;

  try {
    const body = await request.json();
    // Final 100%, F-P1-60 — schema validation (was hand-rolled).
    // A non-number `value` now 400s instead of being silently
    // stored as null (the Sections 21-25 tightening precedent).
    const validation = validateBody(analyticsEventSchema, body ?? {});
    // Narrowing check (not invalidBodyResponse — it does not narrow
    // the union, so validation.data would not type-check). Same 400
    // as invalidBodyResponse: the first error, same message.
    if (!validation.success) {
      const firstError = Object.values(validation.errors).flat()[0];
      return badRequest(firstError ?? 'Invalid request body');
    }
    const { eventType, productId, value, metadata } = validation.data;

    if (typeof eventType !== 'string' || eventType.trim() === '') {
      return badRequest('eventType is required');
    }

    const supabase = await createSupabaseServerClient();

    // Best-effort: associate the event with the authenticated user when possible.
    const auth = await requireAuth(request);
    const userId = !('error' in auth) ? auth.userId : null;

    const { error } = await supabase.from('analytics_events').insert({
      user_id: userId,
      event_type: eventType,
      product_id: typeof productId === 'string' ? productId : null,
      value: typeof value === 'number' ? value : null,
      metadata: metadata ?? null,
    });

    if (error) {
      return internalError('Failed to track analytics event');
    }

    return apiSuccess({ tracked: true });
  } catch (err) {
    logApiError(err, { request, route: 'analytics.events', status: 500 });
    return internalError('Failed to track analytics event');
  }
}
