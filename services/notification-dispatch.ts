/**
 * Notification dispatch service.
 * Drains the notification_queue, sends emails/push, and handles retries.
 * Designed to be called by a cron endpoint or scheduled edge function.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
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

    if (result) {
      await supabase
        .from('notification_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', notif.id);
      sent++;
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

async function dispatchNotification(
  supabase: AnySupabaseClient,
  notif: QueuedNotification
): Promise<boolean> {
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
      return false;
    }

    let emailOk = false;
    let pushOk = false;

    if (wantsEmail) {
      if (!profile?.email) {
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
      pushOk = await sendPushNotification(
        supabase,
        notif.user_id,
        notif.subject ?? 'Notification',
        notif.body
      );
    }

    if (notif.channel === 'both' && emailOk !== pushOk) {
      logger.warn('dispatchNotification: one leg of a both-channel notification failed', {
        notifId: notif.id,
        emailOk,
        pushOk,
      });
    }

    return emailOk || pushOk;
  } catch (err) {
    logger.error('dispatchNotification failed', { error: String(err), notifId: notif.id });
    return false;
  }
}
