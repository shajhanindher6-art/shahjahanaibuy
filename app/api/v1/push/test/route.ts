/**
 * API v1 push test — Section 14, Chunk 7.
 * POST /api/v1/push/test — sends a real test push notification to
 * the signed-in user's own browser subscriptions, using the
 * existing sendPushNotification() in services/push.ts. This is the
 * last step of the settings-page push self-test: it proves delivery
 * end to end instead of only checking that a subscription exists.
 *
 * Honest failure modes, never a fake "sent": VAPID keys not
 * configured → 503 (push is not set up yet); the user has no push
 * subscription on record → 200 with { sent: false, reason:
 * 'no-subscription' }; the push service reports failure for every
 * subscription → 200 with { sent: false, reason: 'send-failed' }.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  apiSuccess,
  internalError,
  serviceUnavailable,
} from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, requireAuth } from '@/lib/api/middleware';
import { sendPushNotification } from '@/services/push';
import { getVapidPublicKey } from '@/services/push';

import { logApiError } from '@/lib/api/error-logging';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'push.test' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  // 5 test pushes per hour per user — enough to self-test, too
  // few to spam a browser.
  const limited = await rateLimitResponse(`push-test:${auth.userId}`, 5, 3_600_000);
  if (limited) return limited;

  if (!getVapidPublicKey()) {
    return serviceUnavailable(
      'Push is not configured yet — the site owner still needs to set the VAPID keys. No test notification was sent.'
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('endpoint')
      .eq('user_id', auth.userId)
      .limit(10);
    if (!subscriptions || subscriptions.length === 0) {
      return apiSuccess({
        sent: false,
        reason: 'no-subscription',
        message: 'This account has no push subscription saved. Turn push notifications on first, then run the test again.',
      });
    }

    const sent = await sendPushNotification(
      supabase,
      auth.userId,
      'SmartBuy test notification',
      'Push notifications are working — this is a test from your settings.'
    );
    if (!sent) {
      return apiSuccess({
        sent: false,
        reason: 'send-failed',
        message: 'The test notification could not be delivered. Your subscription may have expired — try turning push off and on again.',
      });
    }
    return apiSuccess({
      sent: true,
      reason: 'sent',
      message: 'Test notification sent — check your browser notifications.',
    });
  } catch (err) {
    logApiError(err, { request, route: 'push.test', status: 500 });
    return internalError('Failed to send test notification');
  }
}
