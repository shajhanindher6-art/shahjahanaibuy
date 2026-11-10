/**
 * Push subscription endpoint.
 * POST /api/v1/push/subscribe — register a browser push subscription.
 * DELETE /api/v1/push/subscribe — unregister a push subscription.
 *
 * Two flows (S3#8):
 * - Signed-in: as before, requires auth, stored in push_subscriptions.
 * - Guest: no sign-in required. The body carries a `guestToken`
 *   (the browser's random token from lib/push-client.ts) and the
 *   subscription is stored token-based in guest_push_subscriptions
 *   (migration 026). A guest request with neither a session nor a
 *   guestToken is rejected.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import {
  logApiRequest,
  requireAuth,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { savePushSubscription, removePushSubscription } from '@/services/push';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'push.subscribe' });

  const limited = await rateLimitResponse(
    `push-subscribe:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  try {
    const body = await request.json();
    const { endpoint, keys, expirationTime, guestToken } = body ?? {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return badRequest('endpoint, keys.p256dh, and keys.auth are required');
    }

    const supabase = await createSupabaseServerClient();

    // Guest flow: token-based, no account required. Uses the
    // service-role client scoped to the single endpoint row (an
    // upsert needs update-on-conflict, which the anon INSERT-only
    // RLS policy deliberately does not grant).
    if (typeof guestToken === 'string' && guestToken.trim() !== '') {
      const { createSupabaseServiceClient } = await import(
        '@/lib/supabase/service'
      );
      const service = createSupabaseServiceClient();
      if (!service) return internalError('Push subscriptions unavailable');
      const { error } = await service.from('guest_push_subscriptions').upsert(
        {
          guest_token: guestToken.trim(),
          endpoint,
          p256dh_key: keys.p256dh,
          auth_key: keys.auth,
          expiration_time: expirationTime
            ? new Date(expirationTime).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );
      if (error) return internalError('Failed to save push subscription');
      return apiSuccess({ subscribed: true, guest: true });
    }

    // Signed-in flow (unchanged).
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

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

  const limited = await rateLimitResponse(
    `push-unsubscribe:${getClientIp(request)}`,
    30,
    60_000
  );
  if (limited) return limited;

  try {
    const { searchParams } = request.nextUrl;
    const endpoint = searchParams.get('endpoint');
    const guestToken = searchParams.get('guestToken');
    if (!endpoint) return badRequest('endpoint query param is required');

    const supabase = await createSupabaseServerClient();

    // Guest flow: token + endpoint scoped delete (service client,
    // same scoping reason as the POST branch above).
    if (typeof guestToken === 'string' && guestToken.trim() !== '') {
      const { createSupabaseServiceClient } = await import(
        '@/lib/supabase/service'
      );
      const service = createSupabaseServiceClient();
      if (!service) return internalError('Push subscriptions unavailable');
      const { error } = await service
        .from('guest_push_subscriptions')
        .delete()
        .eq('guest_token', guestToken.trim())
        .eq('endpoint', endpoint);
      if (error) return internalError('Failed to remove push subscription');
      return apiSuccess({ unsubscribed: true, guest: true });
    }

    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const ok = await removePushSubscription(supabase, auth.userId, endpoint);
    if (!ok) return internalError('Failed to remove push subscription');
    return apiSuccess({ unsubscribed: true });
  } catch {
    return internalError('Failed to unsubscribe');
  }
}
