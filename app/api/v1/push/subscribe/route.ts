/**
 * Push subscription endpoint.
 * POST /api/v1/push/subscribe — register a browser push subscription.
 * DELETE /api/v1/push/subscribe — unregister a push subscription.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { savePushSubscription, removePushSubscription } from '@/services/push';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'push.subscribe' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const { endpoint, keys, expirationTime } = body ?? {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return badRequest('endpoint, keys.p256dh, and keys.auth are required');
    }

    const supabase = await createSupabaseServerClient();
    const ok = await savePushSubscription(supabase, auth.userId, {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      expirationTime: expirationTime ?? null,
    });

    if (!ok) return internalError('Failed to save push subscription');
    return apiSuccess({ subscribed: true });
  } catch {
    return internalError('Failed to subscribe to push notifications');
  }
}

export async function DELETE(request: NextRequest) {
  logApiRequest(request, { endpoint: 'push.unsubscribe' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  try {
    const { searchParams } = request.nextUrl;
    const endpoint = searchParams.get('endpoint');
    if (!endpoint) return badRequest('endpoint query param is required');

    const supabase = await createSupabaseServerClient();
    const ok = await removePushSubscription(supabase, auth.userId, endpoint);
    if (!ok) return internalError('Failed to remove push subscription');
    return apiSuccess({ unsubscribed: true });
  } catch {
    return internalError('Failed to unsubscribe');
  }
}
