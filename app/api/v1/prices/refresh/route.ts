/**
 * Price refresh worker endpoint (scheduled, not user-facing).
 * POST /api/v1/prices/refresh — one scheduled run of the full chain:
 *
 *   1. refreshTrackedPrices(): record any changed catalog price for
 *      alerted / wishlisted products as a new price_history row.
 *   2. checkPriceAlerts(): compare active alerts with the new prices
 *      and queue notifications for triggered alerts.
 *   3. processNotificationQueue(): drain the queue, sending email
 *      (Resend), web push (VAPID), and WhatsApp/Telegram webhook
 *      alerts for every enabled channel, and leaving an in-app
 *      notification row for every alert even when email/push
 *      providers are unconfigured.
 *   4. (S3#3) recordAvailabilitySnapshots(): record availability per
 *      refresh like price history (availability_history) and detect
 *      out-of-stock → in-stock transitions for back-in-stock alerts.
 *   5. (S3#7) checkGuestEmailAlerts(): compare active guest email
 *      alerts with the new prices/availability and queue guest
 *      emails (guest_notification_queue) + guest push where the
 *      guest subscribed to push on this browser.
 *   6. (S3#7) drainGuestNotificationQueue(): send queued guest
 *      emails via Resend when configured; when Resend is NOT
 *      configured the rows stay `pending` and are reported as
 *      pending — never claimed as delivered.
 *
 * Steps 4–6 are best-effort and fail-safe: a missing migration 026
 * table (or any error inside them) is counted and reported, never
 * fails the whole refresh, and never blocks steps 1–3.
 *
 * SINGLE-SCHEDULER RULE — THIS IS THE CANONICAL TRIGGER (see
 * docs/alerts-delivery-setup.md): schedule exactly ONE free cron job
 * (e.g. cron-job.org) that POSTs to this endpoint, e.g. every
 * 6 hours. Do NOT also schedule /api/v1/alerts/check (it runs the
 * same chain and exists for manual runs), and do NOT also schedule
 * the Supabase price-refresh-worker Edge Function (it calls this
 * same endpoint). Pick ONE trigger, never two — a second trigger
 * only re-runs the same chain per cadence.
 *
 * Protected by CRON_SECRET: the secret must be set in the hosting
 * dashboard, and the caller must send `Authorization: Bearer
 * <CRON_SECRET>`. When CRON_SECRET is unset the endpoint refuses to
 * run (fail closed) instead of accepting unauthenticated trigger
 * calls. Uses the service-role client because the refresh and
 * checker must read alerts and wishlist items belonging to every
 * user. Requires SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard;
 * without it the endpoint fails fast instead of silently checking
 * zero alerts.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refreshTrackedPrices } from '@/services/price-refresh';
import { checkPriceAlerts } from '@/services/alert-checker';
import { processNotificationQueue } from '@/services/notification-dispatch';
import { sendEmail } from '@/services/email';
import { env } from '@/lib/config/env';
import { appConfig } from '@/lib/config/app';
import { logger } from '@/lib/config/logger';
import {
  shouldRecordAvailabilitySnapshot,
  isBackInStockTransition,
  shouldTriggerGuestAlert,
  type AvailabilitySnapshot,
} from '@/lib/local-alerts';
import type { AnySupabaseClient } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------
// S3#3 — availability snapshots (recorded like price history)
// ---------------------------------------------------------------------------

export interface StockRefreshResult {
  tracked: number;
  recorded: number;
  unchanged: number;
  failed: number;
  /** Product ids that transitioned out-of-stock → in-stock. */
  backInStock: string[];
}

interface MerchantStockRow {
  product_id: string;
  price: number | string | null;
  availability: string | null;
  in_stock: boolean;
}

async function recordAvailabilitySnapshots(
  supabase: AnySupabaseClient
): Promise<StockRefreshResult> {
  const result: StockRefreshResult = {
    tracked: 0,
    recorded: 0,
    unchanged: 0,
    failed: 0,
    backInStock: [],
  };

  const productIds = new Set<string>();
  for (const table of ['alerts', 'wishlist_items', 'guest_email_alerts'] as const) {
    try {
      const query =
        table === 'alerts' || table === 'guest_email_alerts'
          ? supabase.from(table).select('product_id').eq('active', true).limit(1000)
          : supabase.from(table).select('product_id').limit(1000);
      const { data } = await query;
      for (const row of (data ?? []) as Array<{ product_id: string }>) {
        if (row.product_id) productIds.add(row.product_id);
      }
    } catch {
      // A missing table (migration 026 not run) just means no guest
      // products to track — the signed-in tables above still work.
    }
  }

  const ids = Array.from(productIds).slice(0, 500);
  result.tracked = ids.length;
  if (ids.length === 0) return result;

  // Current stock per product, from the merchant listings' own
  // in_stock/availability values — never invented.
  const { data: merchantRows, error: merchantError } = await supabase
    .from('merchant_products')
    .select('product_id, price, availability, in_stock')
    .in('product_id', ids)
    .is('deleted_at', null);
  if (merchantError || !merchantRows) {
    logger.warn('recordAvailabilitySnapshots: merchant_products query failed', {
      error: merchantError?.message,
    });
    result.failed = ids.length;
    return result;
  }

  const currentByProduct = new Map<string, AvailabilitySnapshot>();
  for (const row of merchantRows as MerchantStockRow[]) {
    const price =
      row.price !== null && row.price !== undefined
        ? parseFloat(String(row.price))
        : null;
    const prev = currentByProduct.get(row.product_id);
    const inStock = row.in_stock === true;
    const availability: AvailabilitySnapshot['availability'] = inStock
      ? 'in_stock'
      : row.availability === 'in_stock'
        ? 'in_stock'
        : 'out_of_stock';
    const candidate: AvailabilitySnapshot = {
      availability,
      inStock,
      price: Number.isFinite(price as number) ? (price as number) : null,
    };
    if (!prev) {
      currentByProduct.set(row.product_id, candidate);
      continue;
    }
    // Keep the in-stock view when any listing is in stock; price is
    // the lowest in-stock price (or the lowest overall when none is).
    const merged: AvailabilitySnapshot = {
      availability: prev.inStock || inStock ? 'in_stock' : 'out_of_stock',
      inStock: prev.inStock || inStock,
      price:
        prev.price !== null && candidate.price !== null
          ? Math.min(prev.price, candidate.price)
          : (prev.price ?? candidate.price),
    };
    currentByProduct.set(row.product_id, merged);
  }

  // Latest recorded snapshot per product (newest first, first wins).
  const previousByProduct = new Map<string, AvailabilitySnapshot>();
  try {
    const { data: historyRows } = await supabase
      .from('availability_history')
      .select('product_id, availability, in_stock, price, recorded_at')
      .in('product_id', ids)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    for (const row of (historyRows ?? []) as Array<{
      product_id: string;
      availability: string;
      in_stock: boolean;
      price: number | string | null;
    }>) {
      if (!previousByProduct.has(row.product_id)) {
        previousByProduct.set(row.product_id, {
          availability:
            row.availability === 'in_stock'
              ? 'in_stock'
              : row.availability === 'out_of_stock'
                ? 'out_of_stock'
                : 'unknown',
          inStock: row.in_stock === true,
          price:
            row.price !== null && row.price !== undefined
              ? parseFloat(String(row.price))
              : null,
        });
      }
    }
  } catch {
    // availability_history missing (migration 026 not run): every
    // product looks "new", so inserts below fail per-row and are
    // counted — the run still reports honestly instead of crashing.
  }

  for (const productId of ids) {
    try {
      const next = currentByProduct.get(productId);
      if (!next) {
        // No merchant listings at all: record "unknown" once, so a
        // later listing appearing is a visible transition.
        const unknown: AvailabilitySnapshot = {
          availability: 'unknown',
          inStock: false,
          price: null,
        };
        const prev = previousByProduct.get(productId) ?? null;
        if (!shouldRecordAvailabilitySnapshot(prev, unknown)) {
          result.unchanged++;
          continue;
        }
        const { error } = await supabase.from('availability_history').insert({
          product_id: productId,
          retailer_id: null,
          availability: 'unknown',
          in_stock: false,
          price: null,
        });
        if (error) result.failed++;
        else result.recorded++;
        continue;
      }
      const prev = previousByProduct.get(productId) ?? null;
      if (isBackInStockTransition(prev, next)) {
        result.backInStock.push(productId);
      }
      if (!shouldRecordAvailabilitySnapshot(prev, next)) {
        result.unchanged++;
        continue;
      }
      const { error } = await supabase.from('availability_history').insert({
        product_id: productId,
        retailer_id: null,
        availability: next.availability,
        in_stock: next.inStock,
        price: next.price,
      });
      if (error) {
        logger.warn('recordAvailabilitySnapshots: insert failed', {
          productId,
          error: error.message,
        });
        result.failed++;
      } else {
        result.recorded++;
      }
    } catch (err) {
      logger.warn('recordAvailabilitySnapshots: product failed', {
        productId,
        error: String(err),
      });
      result.failed++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// S3#7 + S3#8 — guest email alerts (+ guest push where subscribed)
// ---------------------------------------------------------------------------

export interface GuestAlertsResult {
  checked: number;
  triggered: number;
  queued: number;
  pushSent: number;
  pushFailed: number;
  failed: number;
}

interface GuestAlertRow {
  id: string;
  email: string;
  product_id: string;
  alert_type: string;
  target_price: number | string | null;
  guest_token: string | null;
  last_triggered_at: string | null;
  last_triggered_price: number | string | null;
  trigger_count: number;
}

async function sendGuestPush(
  supabase: AnySupabaseClient,
  guestToken: string,
  title: string,
  body: string
): Promise<boolean> {
  if (!env.vapidPublicKey || !env.vapidPrivateKey) return false;
  try {
    const webpushModule = await import('web-push').catch(() => null);
    if (!webpushModule) return false;
    const webpush = webpushModule;
    webpush.setVapidDetails(
      `mailto:${env.emailFromAddress}`,
      env.vapidPublicKey,
      env.vapidPrivateKey
    );
    const { data: subs } = await supabase
      .from('guest_push_subscriptions')
      .select('endpoint, p256dh_key, auth_key')
      .eq('guest_token', guestToken);
    if (!subs || subs.length === 0) return false;
    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    });
    let sentAny = false;
    for (const sub of subs as Array<Record<string, unknown>>) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint as string,
            keys: {
              p256dh: sub.p256dh_key as string,
              auth: sub.auth_key as string,
            },
          },
          payload
        );
        sentAny = true;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await supabase
            .from('guest_push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        }
        logger.warn('sendGuestPush failed for endpoint', { error: String(err) });
      }
    }
    return sentAny;
  } catch (err) {
    logger.warn('sendGuestPush failed', { error: String(err) });
    return false;
  }
}

async function checkGuestEmailAlerts(
  supabase: AnySupabaseClient,
  backInStockProductIds: Set<string>
): Promise<GuestAlertsResult> {
  const result: GuestAlertsResult = {
    checked: 0,
    triggered: 0,
    queued: 0,
    pushSent: 0,
    pushFailed: 0,
    failed: 0,
  };

  let alerts: GuestAlertRow[] = [];
  try {
    const { data, error } = await supabase
      .from('guest_email_alerts')
      .select(
        'id, email, product_id, alert_type, target_price, guest_token, last_triggered_at, last_triggered_price, trigger_count'
      )
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1000);
    if (error || !data) {
      // Table missing (migration 026 not run) → zero guest alerts
      // exist yet; report honestly instead of failing the refresh.
      if (error) {
        logger.warn('checkGuestEmailAlerts: table unavailable', {
          error: error.message,
        });
      }
      return result;
    }
    alerts = data as unknown as GuestAlertRow[];
  } catch (err) {
    logger.warn('checkGuestEmailAlerts: load failed', { error: String(err) });
    return result;
  }

  if (alerts.length === 0) return result;

  const productIds = [...new Set(alerts.map((a) => a.product_id))];

  const productMap = new Map<string, { name: string; slug: string }>();
  try {
    const { data: products } = await supabase
      .from('products')
      .select('id, name, slug')
      .in('id', productIds);
    for (const p of (products ?? []) as Array<Record<string, unknown>>) {
      productMap.set(p.id as string, {
        name: p.name as string,
        slug: p.slug as string,
      });
    }
  } catch {
    // Product names are only for message text — keep going.
  }

  const priceByProduct = new Map<string, number>();
  try {
    const { data: latest } = await supabase
      .from('price_history')
      .select('product_id, price, recorded_at')
      .in('product_id', productIds)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    for (const row of (latest ?? []) as Array<{
      product_id: string;
      price: number | string;
    }>) {
      if (!priceByProduct.has(row.product_id)) {
        const price = parseFloat(String(row.price));
        if (Number.isFinite(price)) priceByProduct.set(row.product_id, price);
      }
    }
  } catch {
    // No prices yet — price_drop alerts simply cannot trigger.
  }

  const dealProductIds = new Set<string>();
  try {
    const { data: deals } = await supabase
      .from('deals')
      .select('product_id')
      .eq('active', true)
      .is('deleted_at', null)
      .gte('end_at', new Date().toISOString())
      .in('product_id', productIds);
    for (const d of (deals ?? []) as Array<{ product_id: string }>) {
      if (d.product_id) dealProductIds.add(d.product_id);
    }
  } catch {
    // No deals readable — deal alerts simply cannot trigger.
  }

  for (const row of alerts) {
    result.checked++;
    try {
      const product = productMap.get(row.product_id);
      if (!product) {
        result.failed++;
        continue;
      }
      const target =
        row.target_price !== null && row.target_price !== undefined
          ? parseFloat(String(row.target_price))
          : null;
      const price = priceByProduct.get(row.product_id) ?? null;
      const productUrl = `${appConfig.url}/products/${product.slug}`;

      const shouldTrigger = shouldTriggerGuestAlert(
        {
          alertType:
            row.alert_type === 'price_drop' ||
            row.alert_type === 'back_in_stock' ||
            row.alert_type === 'deal'
              ? row.alert_type
              : 'price_drop',
          targetPrice: target,
          lastTriggeredPrice:
            row.last_triggered_price !== null &&
            row.last_triggered_price !== undefined
              ? parseFloat(String(row.last_triggered_price))
              : null,
          lastTriggeredAt: row.last_triggered_at,
        },
        {
          price,
          backInStock: backInStockProductIds.has(row.product_id),
          hasActiveDeal: dealProductIds.has(row.product_id),
        }
      );
      if (!shouldTrigger) continue;

      let subject = '';
      let body = '';
      if (row.alert_type === 'price_drop' && price !== null) {
        subject = `Price drop alert: ${product.name} is now $${price.toFixed(2)}!`;
        body =
          `Great news! ${product.name} dropped to $${price.toFixed(2)}` +
          (target !== null ? ` (your target was $${target.toFixed(2)})` : '') +
          `. View it at ${productUrl}`;
      } else if (row.alert_type === 'back_in_stock') {
        subject = `Back in stock: ${product.name}`;
        body = `${product.name} is back in stock` +
          (price !== null ? ` at $${price.toFixed(2)}` : '') +
          `. View it at ${productUrl}`;
      } else {
        subject = `New deal: ${product.name}`;
        body = `There is a new deal on ${product.name}. View it at ${productUrl}`;
      }

      // Queue the email (stored; sent by drainGuestNotificationQueue
      // below when Resend is configured).
      const { error: queueError } = await supabase
        .from('guest_notification_queue')
        .insert({
          guest_alert_id: row.id,
          email: row.email,
          subject,
          body,
          product_id: row.product_id,
        });
      if (queueError) {
        logger.warn('checkGuestEmailAlerts: queue insert failed', {
          alertId: row.id,
          error: queueError.message,
        });
        result.failed++;
        continue;
      }
      result.queued++;

      // Guest push leg, when this browser subscribed (best effort).
      if (row.guest_token) {
        const pushed = await sendGuestPush(supabase, row.guest_token, subject, body);
        if (pushed) result.pushSent++;
        else result.pushFailed++;
      }

      await supabase
        .from('guest_email_alerts')
        .update({
          last_triggered_at: new Date().toISOString(),
          last_triggered_price:
            row.alert_type === 'price_drop' ? price : row.last_triggered_price,
          trigger_count: (row.trigger_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      result.triggered++;
    } catch (err) {
      logger.error('checkGuestEmailAlerts: alert failed', {
        alertId: row.id,
        error: String(err),
      });
      result.failed++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// S3#7 — drain the guest email queue (Resend-gated, honest reporting)
// ---------------------------------------------------------------------------

export interface GuestQueueResult {
  processed: number;
  sent: number;
  failed: number;
  /** Rows left pending because email delivery is not configured. */
  pendingNoProvider: number;
}

async function drainGuestNotificationQueue(
  supabase: AnySupabaseClient
): Promise<GuestQueueResult> {
  const result: GuestQueueResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    pendingNoProvider: 0,
  };

  let rows: Array<{
    id: string;
    email: string;
    subject: string;
    body: string;
  }> = [];
  try {
    const { data, error } = await supabase
      .from('guest_notification_queue')
      .select('id, email, subject, body')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);
    if (error || !data) {
      if (error) {
        logger.warn('drainGuestNotificationQueue: table unavailable', {
          error: error.message,
        });
      }
      return result;
    }
    rows = data as typeof rows;
  } catch (err) {
    logger.warn('drainGuestNotificationQueue: load failed', { error: String(err) });
    return result;
  }

  if (rows.length === 0) return result;

  // No provider configured: leave every row pending and say so.
  // Claiming delivery here would be inventing it.
  if (!env.resendApiKey) {
    result.pendingNoProvider = rows.length;
    return result;
  }

  for (const row of rows) {
    result.processed++;
    try {
      const sent = await sendEmail(
        {
          to: row.email,
          subject: row.subject,
          html: row.body.replace(/\n/g, '<br>'),
          text: row.body,
        },
        'price_alert'
      );
      if (sent.success) {
        await supabase
          .from('guest_notification_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', row.id);
        result.sent++;
      } else {
        await supabase
          .from('guest_notification_queue')
          .update({ status: 'failed', error_message: sent.error ?? 'Send failed' })
          .eq('id', row.id);
        result.failed++;
      }
    } catch (err) {
      logger.warn('drainGuestNotificationQueue: send failed', {
        id: row.id,
        error: String(err),
      });
      result.failed++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'prices.refresh' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  // Cron calls every 6h; 30/min leaves ample headroom for manual runs.
  const limited = await rateLimitResponse(`prices.refresh:${getClientIp(request)}`, 30);
  if (limited) return limited;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return internalError(
      'CRON_SECRET is not configured; set it in the hosting dashboard before scheduling this endpoint'
    );
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return unauthorized('Invalid cron secret');
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return internalError(
      'SUPABASE_SERVICE_ROLE_KEY is not configured; price refresh requires the service-role client'
    );
  }

  try {
    const refresh = await refreshTrackedPrices(supabase);
    const alerts = await checkPriceAlerts(supabase);
    const notifications = await processNotificationQueue(supabase);

    // S3#3 + S3#7: fail-safe — these steps report their own counts
    // and can never fail the refresh above.
    let stock: StockRefreshResult = {
      tracked: 0,
      recorded: 0,
      unchanged: 0,
      failed: 0,
      backInStock: [],
    };
    let guestAlerts: GuestAlertsResult = {
      checked: 0,
      triggered: 0,
      queued: 0,
      pushSent: 0,
      pushFailed: 0,
      failed: 0,
    };
    let guestEmail: GuestQueueResult = {
      processed: 0,
      sent: 0,
      failed: 0,
      pendingNoProvider: 0,
    };
    try {
      stock = await recordAvailabilitySnapshots(supabase);
    } catch (err) {
      logger.warn('prices.refresh: availability snapshots failed', {
        error: String(err),
      });
      stock.failed = stock.tracked;
    }
    try {
      guestAlerts = await checkGuestEmailAlerts(
        supabase,
        new Set(stock.backInStock)
      );
    } catch (err) {
      logger.warn('prices.refresh: guest alert check failed', {
        error: String(err),
      });
      guestAlerts.failed++;
    }
    try {
      guestEmail = await drainGuestNotificationQueue(supabase);
    } catch (err) {
      logger.warn('prices.refresh: guest queue drain failed', {
        error: String(err),
      });
    }

    return apiSuccess({ refresh, alerts, notifications, stock, guestAlerts, guestEmail });
  } catch {
    return internalError('Failed to refresh prices');
  }
}
