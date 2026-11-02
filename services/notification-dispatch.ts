/**
 * Notification dispatch service.
 * Drains the notification_queue, sends emails/push, and handles retries.
 * Designed to be called by a cron endpoint or scheduled edge function.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';
import { sendEmail, sendWeeklyDigestEmail, sendPriceAlertEmail } from '@/services/email';
import { sendPushNotification } from '@/services/push';

interface QueuedNotification {
  id: string;
  user_id: string;
  type: string;
  channel: string;
  subject: string | null;
  body: string;
  data: Record<string, unknown> | null;
  retry_count: number;
  max_retries: number;
  scheduled_for: string;
}

export async function processNotificationQueue(
  supabase: AnySupabaseClient,
  batchSize = 50
): Promise<{ processed: number; sent: number; failed: number }> {
  const now = new Date().toISOString();

  // Fetch pending notifications due now
  const { data, error } = await supabase
    .from('notification_queue')
    .select('id, user_id, type, channel, subject, body, data, retry_count, max_retries, scheduled_for')
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(batchSize);

  if (error || !data || data.length === 0) {
    return { processed: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const notif of data as QueuedNotification[]) {
    const result = await dispatchNotification(supabase, notif);

    if (result.delivered) {
      await supabase
        .from('notification_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', notif.id);
      sent++;
    } else if (result.permanent) {
      // Delivery can never succeed for this row: a required provider
      // is unconfigured, the user has no email address, or the user
      // has no push subscription. Retrying it on every run would spam
      // the queue forever without ever delivering — mark it failed
      // immediately (retry_count untouched) and rely on the in-app
      // notification row created at queue time so the alert is never
      // silently lost.
      await supabase
        .from('notification_queue')
        .update({
          status: 'failed',
          last_error:
            'Delivery unavailable: provider not configured, no email address, or no push subscription. In-app notification retained.',
        })
        .eq('id', notif.id);
      failed++;
    } else {
      const nextRetry = notif.retry_count + 1;
      if (nextRetry >= notif.max_retries) {
        await supabase
          .from('notification_queue')
          .update({ status: 'failed', retry_count: nextRetry, last_error: 'Max retries exceeded' })
          .eq('id', notif.id);
      } else {
        const delay = Math.pow(2, nextRetry) * 60 * 1000;
        const nextRetryAt = new Date(Date.now() + delay).toISOString();
        await supabase
          .from('notification_queue')
          .update({
            retry_count: nextRetry,
            next_retry_at: nextRetryAt,
            scheduled_for: nextRetryAt,
            last_error: 'Send failed, will retry',
          })
          .eq('id', notif.id);
      }
      failed++;
    }
  }

  logger.info('Notification queue processed', { processed: data.length, sent, failed });
  return { processed: data.length, sent, failed };
}

interface DispatchOutcome {
  /** At least one wanted leg was actually delivered. */
  delivered: boolean;
  /**
   * True only when delivery can NEVER succeed for this row: every
   * wanted leg is permanently unavailable (provider unconfigured, no
   * email address, or no push subscription). Transient provider
   * errors are NOT permanent — those keep the existing retry path.
   */
  permanent: boolean;
}

async function dispatchNotification(
  supabase: AnySupabaseClient,
  notif: QueuedNotification
): Promise<DispatchOutcome> {
  try {
    // Get user email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', notif.user_id)
      .maybeSingle();

    // Channel 'both' sends email AND push. It counts as sent when at
    // least one leg succeeds, so a failed push leg does not cause a
    // duplicate email on retry (and vice versa).
    const wantsEmail = notif.channel === 'email' || notif.channel === 'both';
    const wantsPush = notif.channel === 'push' || notif.channel === 'both';

    if (!wantsEmail && !wantsPush) {
      logger.warn('Unknown notification channel', { channel: notif.channel });
      return { delivered: false, permanent: true };
    }

    let emailOk = false;
    let pushOk = false;
    // A leg is "permanently unavailable" when no retry could ever fix
    // it. Provider keys and subscriptions are configuration, not
    // transient failures — retrying them is pure queue spam.
    let emailPermanent = false;
    let pushPermanent = false;

    if (wantsEmail) {
      if (!env.resendApiKey) {
        emailPermanent = true;
        logger.info('dispatchNotification: email leg skipped, RESEND_API_KEY not set', {
          notifId: notif.id,
        });
      } else if (!profile?.email) {
        emailPermanent = true;
        logger.warn('dispatchNotification: no email for user', {
          userId: notif.user_id,
        });
      } else if (notif.type === 'weekly_digest') {
        const result = await sendWeeklyDigestEmail(profile.email, notif.body);
        emailOk = result.success;
      } else if (notif.type === 'price_alert' && notif.data) {
        const d = notif.data as Record<string, unknown>;
        const result = await sendPriceAlertEmail(
          profile.email,
          d.productName as string,
          d.triggeredPrice as number,
          d.targetPrice as number,
          d.productUrl as string
        );
        emailOk = result.success;
      } else {
        const result = await sendEmail({
          to: profile.email,
          subject: notif.subject ?? 'Notification',
          html: notif.body.replace(/\n/g, '<br>'),
          text: notif.body,
        });
        emailOk = result.success;
      }
    }

    if (wantsPush) {
      if (!env.vapidPublicKey || !env.vapidPrivateKey) {
        pushPermanent = true;
        logger.info('dispatchNotification: push leg skipped, VAPID keys not set', {
          notifId: notif.id,
        });
      } else {
        // A user with no stored subscription can never receive a push
        // for this row, no matter how often it is retried.
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('endpoint')
          .eq('user_id', notif.user_id)
          .limit(1);
        if (!subs || subs.length === 0) {
          pushPermanent = true;
          logger.info('dispatchNotification: push leg skipped, no subscription', {
            userId: notif.user_id,
          });
        } else {
          pushOk = await sendPushNotification(
            supabase,
            notif.user_id,
            notif.subject ?? 'Notification',
            notif.body
          );
        }
      }
    }

    if (notif.channel === 'both' && emailOk !== pushOk) {
      logger.warn('dispatchNotification: one leg of a both-channel notification failed', {
        notifId: notif.id,
        emailOk,
        pushOk,
      });
    }

    const delivered = emailOk || pushOk;
    // Permanent only when EVERY wanted leg is permanently unavailable.
    // If any leg merely failed transiently, the row keeps retrying.
    const permanent =
      !delivered &&
      (!wantsEmail || emailPermanent) &&
      (!wantsPush || pushPermanent);

    return { delivered, permanent };
  } catch (err) {
    logger.error('dispatchNotification failed', { error: String(err), notifId: notif.id });
    return { delivered: false, permanent: false };
  }
}
