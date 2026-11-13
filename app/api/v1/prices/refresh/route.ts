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
 *   7. (S6#2) runHuntsForConsentedUsers(): autonomous deal hunting
 *      for users who granted agent-memory consent and have active
 *      hunts — matches require a real recorded in-stock price at or
 *      under the stated budget. Fail-safe, inside THIS chain only:
 *      no second scheduler, and a hunt failure never breaks the
 *      refresh (see the try/catch at the call site).
 *   8. (S15 P4-2) generateWeeklyDigestsForPremiumUsers(): one
 *      weekly digest per active Premium subscriber — but ONLY when
 *      no digest has been stored in the last 7 days. The refresh
 *      runs every 6h; the digest is weekly, so this step usually
 *      reports `due: false` and does nothing. This is the ONLY
 *      digest trigger (no second cron job — single-scheduler rule).
 *      A missing weekly_digests table (migration 009 unapplied)
 *      skips the step honestly instead of failing the run.
 *   9. (S19 P3, §12 #34) resolvePendingPredictionOutcomes():
 *      resolve due 'pending' prediction outcomes against the
 *      lowest price actually recorded inside each horizon. A
 *      missing prediction_outcomes table (migration 032 unapplied)
 *      skips the step honestly instead of failing the run.
 *
 * Steps 4–6 are best-effort and fail-safe: a missing migration 026
 * table (or any error inside them) is counted and reported, never
 * fails the whole refresh, and never blocks steps 1–3.
 *
 * Section 15, P1-9 — eBay AS STEP 0 (services/ebay-refresh.ts):
 * the first LIVE fetch leg. Before any recorded-price step runs,
 * due products are searched on eBay Browse, keyword-matched, and
 * upserted into merchant_products with data_freshness stamped —
 * so the steps below finally have fresh input. The step never
 * throws and never fails the run: on any eBay failure the route
 * degrades to "eBay unavailable, continued on recorded prices"
 * (steps.ebay.status stays 'ok' with a degraded result).
 *
 * Section 17, Stage D — pipeline re-fetch leg, after the eBay
 * step: due products are re-fetched through the provider
 * registry's `price.refresh` processor
 * (services/pipeline-refresh.ts), at most 100 per run, most
 * overdue first. `available: false` (no provider available / no
 * product sources) is an honest skip, never a failure — the run
 * must not report `completed_with_failures` just because no live
 * merchant adapter is configured yet.
 *
 * Section 15, P1-1 — PER-STEP ISOLATION: every step runs through
 * runRefreshStep() (services/refresh-run.ts) in its own try/catch.
 * A throwing step is recorded as `steps.<name>.status: 'failed'`
 * with its error, its counts fall back to zero, and the chain
 * CONTINUES — the handler always returns 200 with per-step
 * results. A failed step is never a silent success. (Steps 4–6
 * already had this shape; steps 1–3 did not, and one throw used
 * to return 500 with no counts and skip every later step.)
 *
 * Section 15, P1-7 — ONE RUN AT A TIME: before the chain starts,
 * tryStartRefreshRun() checks price_refresh_runs (migration 040)
 * for a still-`running` row younger than 30 minutes. When one
 * exists the run is SKIPPED with 200 + `skipped: true` instead of
 * duplicating the chain (cron + /alerts/check + the Edge Function
 * worker are three triggers for the same chain). The guard fails
 * open while migration 040 is unapplied.
 *
 * Section 15, P1-5 — RUN RECORD: one row per run is written to
 * price_refresh_runs (started/finished, overall status, per-step
 * summary) and the latest row is read by /status.
 *
 * Section 15, P1-8 — DB-LOAD FAILURES SURFACE: refreshTrackedPrices
 * (services/price-refresh.ts) and recordAvailabilitySnapshots below
 * check the `error` of every source select; a failed load marks
 * its step `failed` instead of reporting `tracked: 0` + success.
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
import { logApiError } from '@/lib/api/error-logging';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  refreshTrackedPrices,
  buildRefreshSharedReads,
  type PriceRefreshResult,
  type RefreshSharedReads,
} from '@/services/price-refresh';
import {
  refreshEbayPrices,
  type EbayRefreshResult,
} from '@/services/ebay-refresh';
import {
  refreshPricesViaPipeline,
  type PipelineRefreshResult,
} from '@/services/pipeline-refresh';
import { checkPriceAlerts, type AlertCheckResult } from '@/services/alert-checker';
import {
  notifySavedSearchMatches,
  type SavedSearchNotifyResult,
} from '@/services/saved-searches';
import {
  resolvePendingPredictionOutcomes,
  type ResolvePendingOutcomesResult,
} from '@/services/prediction-outcomes';
import {
  generateWeeklyDigestsForPremiumUsers,
  type WeeklyDigestRunResult,
} from '@/services/notifications';
import { runHuntsForConsentedUsers } from '@/lib/agent-hunt';
import { processNotificationQueue } from '@/services/notification-dispatch';
import { sendEmail } from '@/services/email';
import { PUSH_SEND_TIMEOUT_MS } from '@/services/push';
import { withTimeout } from '@/lib/with-timeout';
import { mapWithConcurrencyLimit } from '@/lib/with-concurrency';
import {
  runRefreshStep,
  sanitizeRefreshStepLoadError,
  summarizeStep,
  tryStartRefreshRun,
  finishRefreshRun,
  type RefreshStepSummary,
} from '@/services/refresh-run';
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

/**
 * Section 18, item 36 — `maxDuration` (see
 * app/api/v1/notifications/process/route.ts for the plan
 * constraint): Vercel Hobby caps serverless execution at 60s —
 * DO NOT raise without a paid plan.
 */
export const maxDuration = 60;

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
  /**
   * Section 15, P1-8: true when a source LOAD failed (a tracked-set
   * select, the merchant_products read, or the availability_history
   * read returned an error). The step is reported as failed, never
   * as a silent `tracked: 0` success. Per-row insert failures still
   * land in `failed` and do NOT set this.
   */
  loadFailed: boolean;
  loadError?: string;
}

interface MerchantStockRow {
  product_id: string;
  price: number | string | null;
  availability: string | null;
  in_stock: boolean;
}

async function recordAvailabilitySnapshots(
  supabase: AnySupabaseClient,
  /** Section 18, item 31 — the run's shared reads. When provided,
   *  the tracked-set and merchant_products reads below are skipped
   *  (the builder already failed the share on any read error, so
   *  no load failure can hide here). When null/omitted the step
   *  reads everything itself, exactly as before. */
  shared?: RefreshSharedReads | null
): Promise<StockRefreshResult> {
  const result: StockRefreshResult = {
    tracked: 0,
    recorded: 0,
    unchanged: 0,
    failed: 0,
    backInStock: [],
    loadFailed: false,
  };

  const productIds = new Set<string>();
  if (shared) {
    for (const id of shared.stockIds) productIds.add(id);
  } else {
    for (const table of ['alerts', 'wishlist_items', 'guest_email_alerts'] as const) {
    try {
      const query =
        table === 'alerts' || table === 'guest_email_alerts'
          ? supabase.from(table).select('product_id').eq('active', true).limit(1000)
          : supabase.from(table).select('product_id').limit(1000);
      // Section 15, P1-8: a failed select used to destructure
      // `{ data }` and silently treat it as "no products to track".
      // Check `error`: a failed load marks the step failed, while a
      // table that DID load still contributes its products.
      const { data, error } = await query;
      if (error) {
        // A missing guest_email_alerts table (migration 026 not run
        // yet) means no guest products exist — the designed empty
        // state, not a failure. Any other load error marks the step
        // failed (P1-8), including a missing core table.
        const missingTable = error.code === '42P01' || error.code === 'PGRST205';
        if (missingTable && table === 'guest_email_alerts') continue;
        // Section 18, item 11 — the helper logs the full detail
        // server-side and returns only the generic string, so the
        // response never leaks a table/column name or PostgREST code.
        result.loadFailed = true;
        result.loadError = result.loadError ?? sanitizeRefreshStepLoadError(table, error);
        continue;
      }
      for (const row of (data ?? []) as Array<{ product_id: string }>) {
        if (row.product_id) productIds.add(row.product_id);
      }
    } catch (err) {
      // A missing table (migration 026 not run) just means no guest
      // products to track — the signed-in tables above still work.
      // A throw here is a load failure, not an empty set.
      // (Section 18, item 11 — helper logs server-side, generic in response.)
      result.loadFailed = true;
      result.loadError = result.loadError ?? sanitizeRefreshStepLoadError(table, err);
    }
    }
  }

  const ids = Array.from(productIds).slice(0, 500);
  result.tracked = ids.length;
  if (ids.length === 0) return result;

  // Current stock per product, from the merchant listings' own
  // in_stock/availability values — never invented.
  // Section 18, item 31 — with shared reads the merchant rows are
  // the builder's (same rows, price-ordered; the merge below is
  // order-independent, so the result is identical).
  let merchantRows: MerchantStockRow[] | null = null;
  if (shared) {
    merchantRows = shared.merchantRows.filter((r) => ids.includes(r.product_id));
  } else {
    const { data: merchantData, error: merchantError } = await supabase
      .from('merchant_products')
      .select('product_id, price, availability, in_stock')
      .in('product_id', ids)
      .is('deleted_at', null);
    if (merchantError || !merchantData) {
      result.failed = ids.length;
      // P1-8: no stock was read, so nothing was recorded.
      // (Section 18, item 11 — helper logs server-side, generic in response.)
      result.loadFailed = true;
      result.loadError =
        result.loadError ?? sanitizeRefreshStepLoadError('merchant_products', merchantError);
      return result;
    }
    merchantRows = merchantData as MerchantStockRow[];
  }

  const currentByProduct = new Map<string, AvailabilitySnapshot>();
  for (const row of merchantRows) {
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
    const { data: historyRows, error: historyError } = await supabase
      .from('availability_history')
      .select('product_id, availability, in_stock, price, recorded_at')
      .in('product_id', ids)
      .order('recorded_at', { ascending: false })
      .limit(1000);
    // P1-8: a failed history read must NOT be treated as "no
    // history" — with an empty previous map every product would
    // look new and the inserts below could record duplicates.
    // A missing table (migration 026 not run) is the one exception:
    // every product looks "new", so inserts below fail per-row and
    // are counted — the run still reports honestly instead of
    // crashing. Any other read error fails the step instead.
    if (historyError) {
      const missingTable =
        historyError.code === '42P01' || historyError.code === 'PGRST205';
      if (!missingTable) {
        // (Section 18, item 11 — helper logs server-side, generic in response.)
        result.loadFailed = true;
        result.loadError =
          result.loadError ?? sanitizeRefreshStepLoadError('availability_history', historyError);
        return result;
      }
    }
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

  // Section 18, item 37 — the per-product snapshot writes run
  // with a bounded concurrency pool (cap 5), not one-by-one and
  // not unbounded. Each product's outcome is returned (never
  // thrown) so one product's failure cannot fail the others, and
  // the counts below aggregate exactly as the sequential loop did.
  const outcomes = await mapWithConcurrencyLimit(ids, 5, async (productId) => {
    const outcome = { recorded: 0, unchanged: 0, failed: 0, backInStock: false };
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
          outcome.unchanged++;
          return outcome;
        }
        const { error } = await supabase.from('availability_history').insert({
          product_id: productId,
          retailer_id: null,
          availability: 'unknown',
          in_stock: false,
          price: null,
        });
        if (error) outcome.failed++;
        else outcome.recorded++;
        return outcome;
      }
      const prev = previousByProduct.get(productId) ?? null;
      if (isBackInStockTransition(prev, next)) {
        outcome.backInStock = true;
      }
      if (!shouldRecordAvailabilitySnapshot(prev, next)) {
        outcome.unchanged++;
        return outcome;
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
        outcome.failed++;
      } else {
        outcome.recorded++;
      }
    } catch (err) {
      logger.warn('recordAvailabilitySnapshots: product failed', {
        productId,
        error: String(err),
      });
      outcome.failed++;
    }
    return outcome;
  });
  for (const [i, outcome] of outcomes.entries()) {
    result.recorded += outcome.recorded;
    result.unchanged += outcome.unchanged;
    result.failed += outcome.failed;
    if (outcome.backInStock) result.backInStock.push(ids[i]);
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

async function checkGuestEmailAlerts(
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
  // Section 18, item 31 — with shared reads the history rows are
  // the builder's, filtered to this step's alert products.
  const historyRowsForGuests = shared
    ? shared.historyRows.filter((r) => productIds.includes(r.product_id))
    : null;
  if (historyRowsForGuests) {
    for (const row of historyRowsForGuests) {
      if (!priceByProduct.has(row.product_id)) {
        const price = parseFloat(String(row.price));
        if (Number.isFinite(price)) priceByProduct.set(row.product_id, price);
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
      }>) {
        if (!priceByProduct.has(row.product_id)) {
          const price = parseFloat(String(row.price));
          if (Number.isFinite(price)) priceByProduct.set(row.product_id, price);
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

  // Section 17, Stage G (§4 #11): timing-safe compare via
  // lib/api/cron-auth.ts — fails closed when CRON_SECRET is unset.
  if (!process.env.CRON_SECRET) {
    return internalError(
      'CRON_SECRET is not configured; set it in the hosting dashboard before scheduling this endpoint'
    );
  }
  if (!isCronAuthorized(request)) {
    return unauthorized('Invalid cron secret');
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return internalError(
      'SUPABASE_SERVICE_ROLE_KEY is not configured; price refresh requires the service-role client'
    );
  }

  // Section 15, P1-7 — one run at a time, across all triggers.
  // When another run is in progress this call skips (200 +
  // skipped: true) instead of duplicating the chain. Section 18,
  // item 35 — the guard fails open ONLY while migration 040 is
  // unapplied (missing table); a guard READ/insert error fails
  // safe instead: the run is NOT started (skipped: true, reason
  // 'guard-error'), the cron call is NOT 500'd — the always-200
  // contract holds — and nothing runs unguarded.
  const guard = await tryStartRefreshRun(supabase, 'prices-refresh');
  if (!guard.started) {
    const stepNames = [
      'ebay',
      'pipeline',
      'refresh',
      'alerts',
      'hunts',
      'digest',
      'notifications',
      'stock',
      'guestAlerts',
      'guestEmail',
      'savedSearches',
      'outcomes',
    ] as const;
    const skipMessage =
      guard.reason === 'guard-error'
        ? 'The refresh guard could not be read — the run was not started.'
        : 'Another refresh run is in progress.';
    const steps: Record<string, RefreshStepSummary> = {};
    for (const name of stepNames) {
      steps[name] = { status: 'skipped', error: skipMessage };
    }
    return apiSuccess({
      skipped: true,
      reason: guard.reason ?? 'run-in-progress',
      error: guard.error,
      existingRunId: guard.existingRunId,
      steps,
    });
  }

  // Section 15, P1-1 — every step isolated: a throw (or a
  // load failure, P1-8) records `failed` with its error, keeps
  // zeroed fallback counts, and the chain continues. The handler
  // always returns 200 with per-step results.
  const zeroRefresh: PriceRefreshResult = {
    tracked: 0,
    inserted: 0,
    unchanged: 0,
    skippedNoRetailer: 0,
    skippedNoPrice: 0,
    failed: 0,
    loadFailed: false,
  };
  // Section 15, P1-9 — step 0: the first live fetch leg. The
  // step never throws and gets NO isFailed predicate, so an eBay
  // failure degrades the run ("eBay unavailable, continued on
  // recorded prices") instead of failing it — the steps below
  // still run on the recorded prices.
  const zeroEbay: EbayRefreshResult = {
    status: 'unavailable',
    checked: 0,
    updated: 0,
    inserted: 0,
    skippedMismatch: 0,
    skippedNoListing: 0,
    skippedUnknownCurrency: 0,
    failed: 0,
    budgetExhausted: false,
    products: [],
  };
  // Section 17, Stage D — pipeline step fallback: no provider
  // available (or the due-products read failed) is an honest
  // skip, never a failure — see services/pipeline-refresh.ts.
  const zeroPipeline: PipelineRefreshResult = {
    available: false,
    reason: 'no-available-provider',
    checked: 0,
    refreshed: 0,
    failed: 0,
    errors: [],
  };
  const zeroAlerts: AlertCheckResult = {
    checked: 0,
    triggered: 0,
    queued: 0,
    skippedDuplicate: 0,
    skippedOptedOut: 0,
    failed: 0,
    wishlistChecked: 0,
    wishlistTriggered: 0,
    wishlistQueued: 0,
  };
  const zeroHunts: Awaited<ReturnType<typeof runHuntsForConsentedUsers>> = {
    usersChecked: 0,
    huntsRun: 0,
    matchesCreated: 0,
    huntsEnabled: false,
  };
  // Section 15, P4-2 — weekly digest step. Usually `due: false`
  // (a digest was stored within the last 7 days) — the step then
  // does nothing. A load failure (not a missing table) marks the
  // step failed via the isFailed predicate below.
  const zeroDigest: WeeklyDigestRunResult = {
    due: false,
    generated: 0,
    failed: 0,
    total: 0,
  };
  const zeroNotifications = { processed: 0, sent: 0, failed: 0 };
  const zeroStock: StockRefreshResult = {
    tracked: 0,
    recorded: 0,
    unchanged: 0,
    failed: 0,
    backInStock: [],
    loadFailed: false,
  };
  const zeroGuestAlerts: GuestAlertsResult = {
    checked: 0,
    triggered: 0,
    queued: 0,
    pushSent: 0,
    pushFailed: 0,
    failed: 0,
  };
  const zeroGuestEmail: GuestQueueResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    pendingNoProvider: 0,
  };
  const zeroSavedSearches: SavedSearchNotifyResult = {
    ok: true,
    searchesChecked: 0,
    notified: 0,
  };
  // Section 19, Phase 3 (§12 #34) — prediction-outcome resolution.
  // Resolves due 'pending' outcomes against the prices this run
  // just recorded. A missing prediction_outcomes table (032
  // unapplied) is a clean skip, not a failure — the resolver
  // reports reason 'table-missing' and the step never fails the
  // run (see the isFailed predicate below, same shape as
  // savedSearches).
  const zeroOutcomes: ResolvePendingOutcomesResult = {
    ok: true,
    checked: 0,
    resolved: 0,
    stillPending: 0,
    failed: 0,
  };

  // Section 18, item 37 — the chain runs in WAVES. Steps that
  // depend on earlier steps stay sequential; independent steps run
  // concurrently (Promise.all). Per-step isolation is unchanged —
  // every step is still a runRefreshStep with its zero fallback —
  // and the handler still always returns 200 with per-step status.
  //
  //   Wave A (sequential): ebay → pipeline (live-fetch legs).
  //   Shared reads (item 31): built after A, so they see the
  //     prices A just wrote.
  //   Wave B (parallel): refresh + stock — both read the shared
  //     rows; neither depends on the other.
  //   Wave C (parallel): alerts + hunts + digest + savedSearches —
  //     all run AFTER refresh (they read the price_history rows it
  //     just wrote); digest runs before the notification drain.
  //   Wave D (parallel): notifications + guestAlerts — guestAlerts
  //     needs stock's backInStock (wave B) and refresh's history
  //     (wave B); notifications drains what C queued.
  //   Wave E (sequential): guestEmail — drains the guest queue
  //     that guestAlerts (wave D) just queued.
  const ebay = await runRefreshStep(
    'refreshEbayPrices',
    () => refreshEbayPrices(supabase),
    zeroEbay
  );
  // Section 17, Stage D — pipeline re-fetch leg, after the ebay
  // step and before the recorded-price refresh. Re-fetches due
  // products through the provider registry's `price.refresh`
  // processor (services/pipeline-refresh.ts). available:false is
  // a SKIP, not a failure: no isFailed predicate, so the step
  // never fails the run when no provider is available. Pipeline
  // ingestion is deliberately NOT wired here (wrong tool for a
  // price re-fetch — see services/pipeline-refresh.ts).
  const pipeline = await runRefreshStep(
    'refreshPricesViaPipeline',
    () => refreshPricesViaPipeline(supabase),
    zeroPipeline
  );
  // Section 18, item 31 — ONE merchant_products + ONE price_history
  // read for the three steps below (refresh / stock / guestAlerts),
  // built after the live-fetch legs above so the shared rows see
  // the prices they just wrote. null → each step reads itself,
  // exactly as before (see buildRefreshSharedReads).
  const sharedReads = await buildRefreshSharedReads(supabase);
  const [refresh, stock] = await Promise.all([
    runRefreshStep(
      'refreshTrackedPrices',
      () => refreshTrackedPrices(supabase, sharedReads),
      zeroRefresh,
      (r) => (r.loadFailed ? (r.loadError ?? 'price load failed') : null)
    ),
    // S3#3 + S3#7: fail-safe — these steps report their own counts
    // and can never fail the refresh above.
    runRefreshStep(
      'recordAvailabilitySnapshots',
      () => recordAvailabilitySnapshots(supabase, sharedReads),
      zeroStock,
      (r) => (r.loadFailed ? (r.loadError ?? 'availability load failed') : null)
    ),
  ]);
  const [alerts, hunts, digest, savedSearches, outcomes] = await Promise.all([
    runRefreshStep(
      'checkPriceAlerts',
      () => checkPriceAlerts(supabase),
      zeroAlerts
    ),
    // S6#2: autonomous deal hunting, inside THIS refresh chain only
    // (no second scheduler). Fail-safe by design: the runner never
    // throws, and runRefreshStep is the second layer — a hunt
    // failure must never break the refresh chain.
    runRefreshStep(
      'runHuntsForConsentedUsers',
      () => runHuntsForConsentedUsers(supabase),
      zeroHunts
    ),
    // Section 15, P4-2 — weekly digest, inside THIS chain only (no
    // second scheduler). Runs before the notification drain so a
    // digest generated on this run is queued in time to be sent by
    // the notifications step below. Usually a no-op (`due: false`).
    runRefreshStep(
      'generateWeeklyDigestsForPremiumUsers',
      () => generateWeeklyDigestsForPremiumUsers(supabase),
      zeroDigest,
      (r) => r.error ?? null
    ),
    // Section 16, #32 — saved-search match notifications, inside
    // THIS refresh chain only (no second scheduler). The step never
    // throws and a missing table (042 unapplied) is a clean skip,
    // not a failure — the chain reports it and continues.
    runRefreshStep(
      'notifySavedSearchMatches',
      () => notifySavedSearchMatches(supabase),
      zeroSavedSearches,
      // 'table-missing' (042 unapplied) is a clean skip, not a
      // failure — otherwise every refresh would report
      // completed_with_failures until the owner applies 042.
      (r) => (r.ok || r.reason === 'table-missing' ? null : (r.reason ?? 'saved-search match notifications failed'))
    ),
    // Section 19, Phase 3 (§12 #34) — resolve due prediction
    // outcomes against the price_history rows this run just
    // wrote. Runs AFTER refresh (wave B), in wave C with the
    // other post-refresh steps. Never throws; a missing table
    // (032 unapplied) is a clean skip, not a failure.
    runRefreshStep(
      'resolvePendingPredictionOutcomes',
      () => resolvePendingPredictionOutcomes(supabase),
      zeroOutcomes,
      (r) => (r.ok || r.reason === 'table-missing' ? null : (r.reason ?? 'prediction outcome resolution failed'))
    ),
  ]);
  const [notifications, guestAlerts] = await Promise.all([
    runRefreshStep(
      'processNotificationQueue',
      () => processNotificationQueue(supabase),
      zeroNotifications
    ),
    runRefreshStep(
      'checkGuestEmailAlerts',
      () => checkGuestEmailAlerts(supabase, new Set(stock.result.backInStock), sharedReads),
      zeroGuestAlerts
    ),
  ]);
  const guestEmail = await runRefreshStep(
    'drainGuestNotificationQueue',
    () => drainGuestNotificationQueue(supabase),
    zeroGuestEmail
  );

  // Section 18, item 38 — per-step counts in the stored steps
  // JSONB, so /admin/refresh-runs and /status can show HOW MANY
  // prices a past run refreshed, not just that a step failed.
  // Every count below comes from a number the step already
  // computed — nothing is invented. hunts computes no failure
  // count, so it stores NO counts rather than a fabricated zero.
  // savedSearches stores counts only when ok (failed: 0 is only
  // honest then); otherwise the counts are omitted.
  const steps: Record<string, RefreshStepSummary> = {
    ebay: summarizeStep(ebay, {
      processed: ebay.result.checked,
      succeeded: ebay.result.updated + ebay.result.inserted,
      failed: ebay.result.failed,
      skipped:
        ebay.result.skippedMismatch +
        ebay.result.skippedNoListing +
        ebay.result.skippedUnknownCurrency,
    }),
    pipeline: summarizeStep(pipeline, {
      processed: pipeline.result.checked,
      succeeded: pipeline.result.refreshed,
      failed: pipeline.result.failed,
    }),
    refresh: summarizeStep(refresh, {
      processed: refresh.result.tracked,
      succeeded: refresh.result.inserted + refresh.result.unchanged,
      failed: refresh.result.failed,
      skipped: refresh.result.skippedNoRetailer + refresh.result.skippedNoPrice,
    }),
    alerts: summarizeStep(alerts, {
      processed: alerts.result.checked,
      succeeded: alerts.result.triggered,
      failed: alerts.result.failed,
      skipped: alerts.result.skippedDuplicate,
    }),
    hunts: summarizeStep(hunts),
    digest: summarizeStep(digest, {
      processed: digest.result.total,
      succeeded: digest.result.generated,
      failed: digest.result.failed,
    }),
    notifications: summarizeStep(notifications, {
      processed: notifications.result.processed,
      succeeded: notifications.result.sent,
      failed: notifications.result.failed,
    }),
    stock: summarizeStep(stock, {
      processed: stock.result.tracked,
      succeeded: stock.result.recorded + stock.result.unchanged,
      failed: stock.result.failed,
    }),
    guestAlerts: summarizeStep(guestAlerts, {
      processed: guestAlerts.result.checked,
      succeeded: guestAlerts.result.triggered,
      failed: guestAlerts.result.failed,
    }),
    guestEmail: summarizeStep(guestEmail, {
      processed: guestEmail.result.processed,
      succeeded: guestEmail.result.sent,
      failed: guestEmail.result.failed,
      skipped: guestEmail.result.pendingNoProvider,
    }),
    savedSearches: summarizeStep(
      savedSearches,
      savedSearches.result.ok
        ? {
            processed: savedSearches.result.searchesChecked,
            succeeded: savedSearches.result.notified,
            failed: 0,
          }
        : undefined
    ),
    outcomes: summarizeStep(outcomes, {
      processed: outcomes.result.checked,
      succeeded: outcomes.result.resolved,
      failed: outcomes.result.failed,
      skipped: outcomes.result.stillPending,
    }),
  };
  const failedSteps = Object.entries(steps).filter(
    ([, s]) => s.status === 'failed'
  );
  const overallStatus =
    failedSteps.length === 0
      ? 'completed'
      : failedSteps.length === Object.keys(steps).length
        ? 'failed'
        : 'completed_with_failures';

  // Section 15, P1-5 — record the run (no-op while migration 040
  // is unapplied: finishRefreshRun logs and continues).
  await finishRefreshRun(
    supabase,
    guard.runId,
    steps,
    overallStatus,
    failedSteps.length > 0
      ? failedSteps.map(([name, s]) => `${name}: ${s.error ?? 'failed'}`).join('; ')
      : undefined
  );

  return apiSuccess({
    skipped: false,
    ebay: ebay.result,
    pipeline: pipeline.result,
    refresh: refresh.result,
    alerts: alerts.result,
    hunts: hunts.result,
    digest: digest.result,
    notifications: notifications.result,
    stock: stock.result,
    guestAlerts: guestAlerts.result,
    guestEmail: guestEmail.result,
    savedSearches: savedSearches.result,
    outcomes: outcomes.result,
    steps,
  });
}
