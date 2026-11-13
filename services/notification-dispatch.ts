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
import { sendTelegramAlert, sendWhatsAppAlert } from '@/services/alert-webhooks';
import {
  DEFAULT_ALERT_DELIVERY_SETTINGS,
  getAlertDeliverySettingsByUser,
} from '@/services/settings';
import {
  sendGenericWebhook,
  GENERIC_WEBHOOK_SIGNATURE_HEADER,
  type GenericWebhookStatus,
} from '@/lib/generic-webhook';

/**
 * Option 7: webhook preferences for one user, read from user_settings.
 * Returns null when the row is missing, the migration has not been run,
 * or the read fails — every one of those means "webhook legs not
 * wanted", never a crash and never a guessed destination.
 */
async function getWebhookPrefs(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{
  whatsappEnabled: boolean;
  whatsappPhone: string | null;
  telegramEnabled: boolean;
  telegramChatId: string | null;
} | null> {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('whatsapp_enabled, whatsapp_phone, telegram_enabled, telegram_chat_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      whatsappEnabled: row.whatsapp_enabled === true,
      whatsappPhone: (row.whatsapp_phone as string | null) ?? null,
      telegramEnabled: row.telegram_enabled === true,
      telegramChatId: (row.telegram_chat_id as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Section 6, item 16: generic outbound webhook prefs for one user,
 * read from user_settings (migration 033 columns). Read separately
 * from getWebhookPrefs with its own try/catch, so a missing
 * migration 033 never breaks the WhatsApp/Telegram legs above.
 * Returns null when the row is missing, the migration has not been
 * run, or the read fails — every one of those means "generic leg
 * not wanted", never a crash.
 */
async function getGenericWebhookPrefs(
  supabase: AnySupabaseClient,
  userId: string
): Promise<{
  url: string | null;
  secretHash: string | null;
} | null> {
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('generic_webhook_url, generic_webhook_secret_hash')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const url = (row.generic_webhook_url as string | null) ?? null;
    if (!url || url.trim() === '') return null;
    return {
      url: url.trim(),
      secretHash: (row.generic_webhook_secret_hash as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

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

/** One pending queue-status write, collected during the dispatch loop and flushed in bulk afterwards. */
export interface PendingNotificationStatusUpdate {
  id: string;
  patch: Record<string, unknown>;
}

/** The generic last_error stored for rows that can never deliver (no provider / no address / no subscription). */
export const NOTIFICATION_PERMANENT_FAILURE_ERROR =
  'Delivery unavailable: provider not configured, no email address, or no push subscription. In-app notification retained.';

/**
 * Section 21–25, Stage J, J-P2-1 (notification-dispatch part) —
 * flush collected status updates in bulk. Rows sharing the exact
 * same patch are written with ONE update + `.in('id', ids)` instead
 * of one UPDATE per queued notification, so a 50-row batch costs a
 * handful of writes instead of 50. Retry rows group by
 * `retry_count` (the delay is a function of it), so each distinct
 * retry count is one write. A flush failure is logged, never
 * thrown: the rows stay `pending` and the next run retries them.
 */
export async function flushNotificationStatusUpdates(
  supabase: AnySupabaseClient,
  pending: PendingNotificationStatusUpdate[]
): Promise<void> {
  if (pending.length === 0) return;
  const groups = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
  for (const { id, patch } of pending) {
    const key = JSON.stringify(patch);
    const group = groups.get(key);
    if (group) group.ids.push(id);
    else groups.set(key, { patch, ids: [id] });
  }
  for (const { patch, ids } of groups.values()) {
    try {
      const { error } = await supabase
        .from('notification_queue')
        .update(patch)
        .in('id', ids);
      if (error) {
        logger.warn('flushNotificationStatusUpdates: batch update failed', {
          count: ids.length,
          error: error.message,
        });
      }
    } catch (err) {
      logger.warn('flushNotificationStatusUpdates: batch update threw', {
        count: ids.length,
        error: String(err),
      });
    }
  }
}

export interface NotificationQueueResult {
  processed: number;
  sent: number;
  failed: number;
  /**
   * Sections 21–25, Stage F (F7) — rows where at least one leg
   * was delivered but another leg can never deliver (permanently
   * unavailable, or retries exhausted). Terminal, never retried,
   * never counted as `sent`: a row is `sent` only when every
   * requested leg succeeded.
   */
  partial: number;
}

export async function processNotificationQueue(
  supabase: AnySupabaseClient,
  batchSize = 50
): Promise<NotificationQueueResult> {
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
    return { processed: 0, sent: 0, failed: 0, partial: 0 };
  }

  let sent = 0;
  let failed = 0;
  let partial = 0;

  // Section 21–25, Stage J, J-P2-1 — status writes are COLLECTED
  // here and flushed in bulk after the loop (see
  // flushNotificationStatusUpdates): the old code did one UPDATE
  // per notification inside the loop. If the process dies
  // mid-loop the unflushed rows simply stay `pending` and the next
  // run retries them — the dispatch itself is unchanged.
  // One shared timestamp per batch: per-row timestamps would make
  // every patch JSON-distinct and defeat the grouping in the flush.
  const batchNowMs = Date.now();
  const batchSentAt = new Date(batchNowMs).toISOString();
  const pendingUpdates: PendingNotificationStatusUpdate[] = [];

  for (const notif of data as QueuedNotification[]) {
    const result = await dispatchNotification(supabase, notif);

    if (result.delivered) {
      pendingUpdates.push({
        id: notif.id,
        patch: { status: 'sent', sent_at: batchSentAt },
      });
      // Sections 21–25, Stage F (F7) — a partially delivered row
      // leaves the queue (re-sending would duplicate the delivered
      // leg) but is counted in `partial`, never in `sent`.
      if (result.partial) partial++;
      else sent++;
    } else if (result.permanent) {
      // Delivery can never succeed for this row: a required provider
      // is unconfigured, the user has no email address, or the user
      // has no push subscription. Retrying it on every run would spam
      // the queue forever without ever delivering — mark it failed
      // immediately (retry_count untouched) and rely on the in-app
      // notification row created at queue time so the alert is never
      // silently lost.
      pendingUpdates.push({
        id: notif.id,
        patch: {
          status: 'failed',
          last_error: NOTIFICATION_PERMANENT_FAILURE_ERROR,
        },
      });
      failed++;
    } else {
      const nextRetry = notif.retry_count + 1;
      if (nextRetry >= notif.max_retries) {
        pendingUpdates.push({
          id: notif.id,
          patch: { status: 'failed', retry_count: nextRetry, last_error: 'Max retries exceeded' },
        });
      } else {
        const delay = Math.pow(2, nextRetry) * 60 * 1000;
        const nextRetryAt = new Date(batchNowMs + delay).toISOString();
        pendingUpdates.push({
          id: notif.id,
          patch: {
            retry_count: nextRetry,
            next_retry_at: nextRetryAt,
            scheduled_for: nextRetryAt,
            last_error: 'Send failed, will retry',
          },
        });
      }
      failed++;
    }
  }

  await flushNotificationStatusUpdates(supabase, pendingUpdates);

  logger.info('Notification queue processed', { processed: data.length, sent, failed, partial });
  return { processed: data.length, sent, failed, partial };
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
  /**
   * Sections 21–25, Stage F (F7) — true when at least one wanted
   * leg was delivered but another wanted leg is permanently
   * unavailable and can never deliver. The row is terminal (never
   * retried — retrying would duplicate the delivered leg) but must
   * never be counted as fully `sent`.
   */
  partial: boolean;
  /**
   * Generic webhook leg outcome (Section 6, item 16): 'sent' only
   * on an HTTP 2xx from the user's endpoint, 'failed' on a
   * non-2xx/network error, 'not_configured' when no URL is
   * registered. Null when the leg did not apply (not a price_alert
   * or no URL registered).
   */
  genericWebhook?: GenericWebhookStatus | null;
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

    // Section 19, Phase 0 (§12 #65): master switches — defense
    // in depth for rows queued BEFORE the user opted out (the
    // checker enforces the same switches before queueing, so a
    // row normally never reaches here opted-out). price_alerts
    // off blocks every leg and the row is failed permanently
    // (it can never deliver while opted out; the checker fires a
    // fresh alert if the price moves again). The channel
    // switches below block only their own leg. Other
    // notification types (e.g. weekly_digest) are unaffected.
    let alertSettings = DEFAULT_ALERT_DELIVERY_SETTINGS;
    if (notif.type === 'price_alert') {
      const byUser = await getAlertDeliverySettingsByUser(supabase, [notif.user_id]);
      alertSettings = byUser.get(notif.user_id) ?? DEFAULT_ALERT_DELIVERY_SETTINGS;
      if (!alertSettings.priceAlerts) {
        logger.info('dispatchNotification: price alerts off for user, skipping delivery', {
          notifId: notif.id,
          userId: notif.user_id,
        });
        return { delivered: false, permanent: true, partial: false };
      }
    }

    // Channel 'both' sends email AND push. It counts as sent when at
    // least one leg succeeds, so a failed push leg does not cause a
    // duplicate email on retry (and vice versa).
    const wantsEmail =
      (notif.channel === 'email' || notif.channel === 'both') &&
      alertSettings.emailNotifications;
    const wantsPush =
      (notif.channel === 'push' || notif.channel === 'both') &&
      alertSettings.pushNotifications;

    // Option 7: WhatsApp/Telegram legs are preference-driven, not
    // channel-field-driven, and fire ONLY for price_alert rows where
    // the user enabled the channel and saved a destination. Other
    // notification types never touch these channels.
    const webhookPrefs =
      notif.type === 'price_alert' ? await getWebhookPrefs(supabase, notif.user_id) : null;
    const wantsWhatsApp = Boolean(
      webhookPrefs?.whatsappEnabled && webhookPrefs?.whatsappPhone
    );
    const wantsTelegram = Boolean(
      webhookPrefs?.telegramEnabled && webhookPrefs?.telegramChatId
    );

    // Section 6, item 16: generic outbound webhook leg — price_alert
    // only, fires when the user registered their own endpoint URL.
    const genericPrefs =
      notif.type === 'price_alert' ? await getGenericWebhookPrefs(supabase, notif.user_id) : null;
    const wantsGeneric = Boolean(genericPrefs?.url);

    if (!wantsEmail && !wantsPush && !wantsWhatsApp && !wantsTelegram && !wantsGeneric) {
      // Section 19, Phase 0 (§12 #65): this is also where a
      // price_alert lands when the user's channel switches
      // disabled its only wanted legs — say so instead of
      // blaming an unknown channel.
      if (notif.type === 'price_alert') {
        logger.info('dispatchNotification: no enabled channel for price alert (user switches)', {
          notifId: notif.id,
          userId: notif.user_id,
          channel: notif.channel,
        });
      } else {
        logger.warn('Unknown notification channel', { channel: notif.channel });
      }
      return { delivered: false, permanent: true, partial: false };
    }

    let emailOk = false;
    let pushOk = false;
    // A leg is "permanently unavailable" when no retry could ever fix
    // it. Provider keys and subscriptions are configuration, not
    // transient failures — retrying them is pure queue spam.
    let emailPermanent = false;
    let pushPermanent = false;
    let whatsappOk = false;
    let telegramOk = false;
    let whatsappPermanent = false;
    let telegramPermanent = false;
    let genericOk = false;
    let genericPermanent = false;
    let genericStatus: GenericWebhookStatus | null = null;

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

    // Option 7 webhook legs (price_alert only, preference-driven).
    // Missing owner credentials => permanent skip (fail-closed, no
    // retry spam); a failed provider call stays transient (retries).
    if ((wantsWhatsApp || wantsTelegram) && notif.data) {
      const d = notif.data as Record<string, unknown>;
      const message = {
        productName: (d.productName as string) ?? 'a product you track',
        triggeredPrice: Number(d.triggeredPrice) || 0,
        targetPrice: Number(d.targetPrice) || 0,
        productUrl: (d.productUrl as string) ?? '',
      };
      if (wantsWhatsApp && webhookPrefs?.whatsappPhone) {
        const result = await sendWhatsAppAlert(
          {
            phoneNumberId: env.whatsappPhoneNumberId,
            accessToken: env.whatsappAccessToken,
            templateName: env.whatsappTemplateName,
          },
          webhookPrefs.whatsappPhone,
          message
        );
        if (result.status === 'sent') whatsappOk = true;
        else if (result.status === 'not_configured') whatsappPermanent = true;
      }
      if (wantsTelegram && webhookPrefs?.telegramChatId) {
        const result = await sendTelegramAlert(
          { botToken: env.telegramBotToken },
          webhookPrefs.telegramChatId,
          message
        );
        if (result.status === 'sent') telegramOk = true;
        else if (result.status === 'not_configured') telegramPermanent = true;
      }
    }

    if (notif.channel === 'both' && emailOk !== pushOk) {
      logger.warn('dispatchNotification: one leg of a both-channel notification failed', {
        notifId: notif.id,
        emailOk,
        pushOk,
      });
    }

    // Section 6, item 16 generic webhook leg (price_alert only).
    // POSTs the same PriceDropMessage shape to the user's own
    // endpoint, HMAC-signed when a secret is registered. Counts as
    // delivered ONLY on an HTTP 2xx — never claimed otherwise.
    // Delivery status is recorded in the structured log below (host
    // only, never the full URL or the secret).
    if (wantsGeneric && notif.data) {
      const d = notif.data as Record<string, unknown>;
      const result = await sendGenericWebhook(
        genericPrefs?.url ?? null,
        genericPrefs?.secretHash ?? null,
        {
          productName: (d.productName as string) ?? 'a product you track',
          triggeredPrice: Number(d.triggeredPrice) || 0,
          targetPrice: Number(d.targetPrice) || 0,
          productUrl: (d.productUrl as string) ?? '',
        }
      );
      genericStatus = result.status;
      genericOk = result.status === 'sent';
      // An invalid registered URL can never deliver — permanent.
      // A failed POST (non-2xx / network) stays transient (retries).
      genericPermanent = result.status === 'not_configured';
      let host = 'unknown';
      try {
        host = new URL(genericPrefs?.url ?? '').hostname;
      } catch {
        host = 'invalid-url';
      }
      logger.info('dispatchNotification: generic webhook delivery', {
        notifId: notif.id,
        userId: notif.user_id,
        host,
        signed: Boolean(genericPrefs?.secretHash),
        signatureHeader: GENERIC_WEBHOOK_SIGNATURE_HEADER,
        status: result.status,
        detail: result.detail,
      });
    }

    const delivered = emailOk || pushOk || whatsappOk || telegramOk || genericOk;
    // Permanent only when EVERY wanted leg is permanently unavailable.
    // If any leg merely failed transiently, the row keeps retrying.
    // (A generic POST failure is transient; only an invalid
    // registered URL is permanent.)
    const permanent =
      !delivered &&
      (!wantsEmail || emailPermanent) &&
      (!wantsPush || pushPermanent) &&
      (!wantsWhatsApp || whatsappPermanent) &&
      (!wantsTelegram || telegramPermanent) &&
      (!wantsGeneric || genericPermanent);
    // Sections 21–25, Stage F (F7) — partial delivery: at least
    // one leg got through, but another wanted leg can never
    // deliver. The row is terminal (the delivered leg must not be
    // re-sent) yet it is NOT a full send.
    const partial =
      delivered &&
      ((wantsEmail && emailPermanent) ||
        (wantsPush && pushPermanent) ||
        (wantsWhatsApp && whatsappPermanent) ||
        (wantsTelegram && telegramPermanent) ||
        (wantsGeneric && genericPermanent));

    return { delivered, permanent, partial, genericWebhook: genericStatus };
  } catch (err) {
    logger.error('dispatchNotification failed', { error: String(err), notifId: notif.id });
    return { delivered: false, permanent: false, partial: false };
  }
}
