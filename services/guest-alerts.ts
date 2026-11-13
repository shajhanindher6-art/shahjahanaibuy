/**
 * Guest email alerts — the guest path of the refresh chain
 * (S3#7 + S3#8).
 *
 * Sections 21–25, Stage F (P0 #2) — this used to live inside
 * app/api/v1/prices/refresh/route.ts, where it could not be
 * exported: Next.js route modules may only export handlers, and
 * the generated route types reject any other export. The guest
 * stale-gate tests import this function directly, so it lives
 * here as a plain service module and the route imports it.
 * Behaviour is unchanged by the move.
 */
import { env } from '@/lib/config/env';
import { appConfig } from '@/lib/config/app';
import { logger } from '@/lib/config/logger';
import { logApiError } from '@/lib/api/error-logging';
import { withTimeout } from '@/lib/with-timeout';
import { PUSH_SEND_TIMEOUT_MS } from '@/services/push';
import { alertPriceFreshness, alertUnknownAgeNote } from '@/lib/price-freshness';
import { shouldTriggerGuestAlert } from '@/lib/local-alerts';
import type { RefreshSharedReads } from '@/services/price-refresh';
import type { AnySupabaseClient } from '@/lib/supabase/types';

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
  /**
   * Section 21, P0 #2 — guest alerts that WOULD have fired but
   * were suppressed because the triggering price is stale
   * (recorded more than STALE_PRICE_DAYS ago). Same meaning as
   * AlertCheckResult.skippedStale for signed-in alerts (§12 #81):
   * a stale price must never fire an "is now $Y!" guest alert.
   */
  skippedStale: number;
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
        // Section 15, P1-3: bound each push send (10s) so a hung
        // push endpoint cannot stall the guest-alert step.
        await withTimeout(
          webpush.sendNotification(
            {
              endpoint: sub.endpoint as string,
              keys: {
                p256dh: sub.p256dh_key as string,
                auth: sub.auth_key as string,
              },
            },
            payload
          ),
          PUSH_SEND_TIMEOUT_MS,
          'Guest web push send'
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

export async function checkGuestEmailAlerts(
  supabase: AnySupabaseClient,
  backInStockProductIds: Set<string>,
  /** Section 18, item 31 — the run's shared reads. When provided,
   *  the price_history read below is skipped (the builder's rows
   *  are a superset of this step's columns, same newest-first
   *  order, so first-wins per product is identical). The guest
   *  alert rows themselves are still read here — their full
   *  columns are not in the shared set. */
  shared?: RefreshSharedReads | null
): Promise<GuestAlertsResult> {
  const result: GuestAlertsResult = {
    checked: 0,
    triggered: 0,
    queued: 0,
    pushSent: 0,
    pushFailed: 0,
    failed: 0,
    skippedStale: 0,
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

  // Section 21, P0 #2 — the price map carries the check date
  // behind each price (recorded_at), not just the price: the
  // stale gate below suppresses "is now $Y!" guest alerts on
  // prices older than STALE_PRICE_DAYS. The query already
  // selected recorded_at and dropped it; the shared-reads rows
  // carry it too (PriceHistorySharedRow.recorded_at).
  const priceByProduct = new Map<string, { price: number; recordedAt: string | null }>();
  // Section 18, item 31 — with shared reads the history rows are
  // the builder's, filtered to this step's alert products.
  const historyRowsForGuests = shared
    ? shared.historyRows.filter((r) => productIds.includes(r.product_id))
    : null;
  if (historyRowsForGuests) {
    for (const row of historyRowsForGuests) {
      if (!priceByProduct.has(row.product_id)) {
        const price = parseFloat(String(row.price));
        if (Number.isFinite(price))
          priceByProduct.set(row.product_id, {
            price,
            recordedAt: row.recorded_at ?? null,
          });
      }
    }
  } else {
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
        recorded_at: string | null;
      }>) {
        if (!priceByProduct.has(row.product_id)) {
          const price = parseFloat(String(row.price));
          if (Number.isFinite(price))
            priceByProduct.set(row.product_id, {
              price,
              recordedAt: row.recorded_at ?? null,
            });
        }
      }
    } catch {
      // No prices yet — price_drop alerts simply cannot trigger.
    }
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
      const price = priceByProduct.get(row.product_id)?.price ?? null;
      const recordedAt = priceByProduct.get(row.product_id)?.recordedAt ?? null;
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
          // §12 #67: backInStockProductIds is the transition set
          // from recordAvailabilitySnapshots (out→in per
          // availability_history), passed explicitly as the
          // transition — never raw in-stock membership.
          backInStock: backInStockProductIds.has(row.product_id),
          backInStockTransition: backInStockProductIds.has(row.product_id),
          hasActiveDeal: dealProductIds.has(row.product_id),
        }
      );
      if (!shouldTrigger) continue;

      // Section 21, P0 #2 — the 7-day stale gate Section 20
      // applied to signed-in alerts (§12 #81), now on the guest
      // path too. price_drop announces a CURRENT price ("is now
      // $Y!"), and back_in_stock prints the price when one is
      // known, so a triggering price older than STALE_PRICE_DAYS
      // suppresses the alert entirely: counted in skippedStale,
      // never queued, never recorded as a trigger, no
      // last_triggered_at update. An unknown age does not
      // suppress (the price may be fresh) but the body is
      // qualified so it never reads as a confirmed current price.
      // deal alerts make no "is now" claim and are not gated —
      // same as the signed-in checker. back_in_stock with NO
      // price is not gated either: the transition itself was
      // detected by this run's availability snapshots, so the
      // event is current by construction — only a stale "$Y" in
      // the body would be a false current-price claim.
      let gateRecordedAt: string | null | undefined;
      if (row.alert_type === 'price_drop') {
        gateRecordedAt = recordedAt;
      } else if (row.alert_type === 'back_in_stock' && price !== null) {
        gateRecordedAt = recordedAt;
      }
      let qualifyUnknownAge = false;
      if (gateRecordedAt !== undefined) {
        const freshness = alertPriceFreshness(gateRecordedAt);
        if (freshness === 'stale') {
          result.skippedStale++;
          continue;
        }
        qualifyUnknownAge = freshness === 'unknown';
      }

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
      if (qualifyUnknownAge) body += alertUnknownAgeNote();

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
      // Section 18, Phase 0: was logger.error only — now also
      // Sentry-captured (when configured) with status/duration/id.
      // The other step-helper catches stay logger.warn: they are
      // expected degradations (missing table, load failure), not
      // errors, and must not become Sentry noise.
      logApiError(err, {
        route: 'prices.refresh',
        status: 500,
        context: { step: 'checkGuestEmailAlerts', alertId: row.id },
      });
      result.failed++;
    }
  }

  return result;
}
