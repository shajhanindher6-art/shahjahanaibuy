/**
 * Push notification service — Web Push API (VAPID).
 * Stores browser push subscriptions and sends push messages.
 * Falls back gracefully when VAPID keys are not set.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime: number | null;
}

export async function savePushSubscription(
  supabase: AnySupabaseClient,
  userId: string,
  subscription: PushSubscriptionData
): Promise<boolean> {
  try {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
    await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh_key: subscription.keys.p256dh,
      auth_key: subscription.keys.auth,
      expiration_time: subscription.expirationTime
        ? new Date(subscription.expirationTime).toISOString()
        : null,
      user_agent: userAgent,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    return true;
  } catch (err) {
    logger.error('savePushSubscription failed', { error: String(err) });
    return false;
  }
}

export async function removePushSubscription(
  supabase: AnySupabaseClient,
  userId: string,
  endpoint: string
): Promise<boolean> {
  try {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);
    return true;
  } catch (err) {
    logger.error('removePushSubscription failed', { error: String(err) });
    return false;
  }
}

export async function sendPushNotification(
  supabase: AnySupabaseClient,
  userId: string,
  title: string,
  body: string
): Promise<boolean> {
  if (!env.vapidPublicKey || !env.vapidPrivateKey) {
    logger.info('Push not sent (VAPID keys not set)', { userId });
    return false;
  }

  try {
    const webpushModule = await import('web-push').catch(() => null);
    if (!webpushModule) {
      logger.info('Push not sent (web-push not installed)', { userId });
      return false;
    }
    const webpush = webpushModule;
    webpush.setVapidDetails(
      `mailto:${env.emailFromAddress}`,
      env.vapidPublicKey,
      env.vapidPrivateKey
    );

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh_key, auth_key, expiration_time')
      .eq('user_id', userId);

    if (!subscriptions || subscriptions.length === 0) return false;

    const payload = JSON.stringify({ title, body, icon: '/icon-192.png', badge: '/icon-192.png' });
    let sentAny = false;

    for (const sub of subscriptions as Array<Record<string, unknown>>) {
      const pushSub = {
        endpoint: sub.endpoint as string,
        keys: { p256dh: sub.p256dh_key as string, auth: sub.auth_key as string },
      };
      try {
        await webpush.sendNotification(pushSub, payload);
        sentAny = true;
      } catch (err) {
        const error = err as { statusCode?: number };
        if (error.statusCode === 410 || error.statusCode === 404) {
          // Subscription expired — remove it
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        }
        logger.warn('Push send failed for endpoint', { error: String(err) });
      }
    }

    return sentAny;
  } catch (err) {
    logger.error('sendPushNotification failed', { error: String(err) });
    return false;
  }
}

export function getVapidPublicKey(): string | null {
  return env.vapidPublicKey ?? null;
}
