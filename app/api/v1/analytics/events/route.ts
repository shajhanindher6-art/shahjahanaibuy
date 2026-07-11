/**
 * API v1 analytics events endpoint.
 * POST /api/v1/analytics/events — track an analytics event.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'analytics.events.track' });

  try {
    const body = await request.json();
    const { eventType, productId, value, metadata } = body ?? {};

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
  } catch {
    return internalError('Failed to track analytics event');
  }
}
