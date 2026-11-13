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
 * the first LIVE fetch leg in code — but NOT live today: eBay is
 * owner-gated (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET unset and the
 * `merchants` row slug='ebay' missing), so step 0 reports
 * 'not-configured' / 'merchant-missing' and the chain below
 * re-reads recorded prices (Section 20, §12 #38). When the owner
 * unblocks eBay, due products are searched on eBay Browse,
 * keyword-matched, and upserted into merchant_products with
 * data_freshness stamped — so the steps below finally have fresh
 * input. The step never throws and never fails the run: on any
 * eBay failure the route degrades to "eBay unavailable, continued
 * on recorded prices" (steps.ebay.status stays 'ok' with a
 * degraded result).
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
 * Sections 21–25, Stage D (item 5) — CHAIN-LEVEL RETRY: after
 * the waves, failed steps are re-run ONCE after a 2s backoff
 * (retryFailedRefreshSteps, services/refresh-run.ts), in wave
 * order, and the retry is recorded (`steps.<name>.attempts: 2`
 * + top-level `chainRetry` in the response). A transient failure
 * no longer fails the step for the whole 6h cycle.
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
 * calls. Section 20, §12 #56: a signed-in admin session is also
 * accepted (same fallback as predictions/outcomes + uptime/check),
 * so an admin can trigger a manual refresh from
 * /admin/refresh-runs; cron callers are unaffected. Uses the service-role client because the refresh and
 * checker must read alerts and wishlist items belonging to every
 * user. Requires SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard;
 * without it the endpoint fails fast instead of silently checking
 * zero alerts.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp, requireAdmin } from '@/lib/api/middleware';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { logApiError } from '@/lib/api/error-logging';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  refreshTrackedPrices,
  buildRefreshSharedReads,
  type PriceRefreshResult,
  type RefreshSharedReads,
} from '@/services/price-refresh';
import {
  refreshEbayPrices,
  EBAY_PRICE_HISTORY_NOTE,
  type EbayRefreshResult,
} from '@/services/ebay-refresh';
import {
  refreshPricesViaPipeline,
  type PipelineRefreshResult,
} from '@/services/pipeline-refresh';
import {
  checkPriceAlerts,
  type AlertCheckResult,
} from '@/services/alert-checker';
import {
  checkGuestEmailAlerts,
  type GuestAlertsResult,
} from '@/services/guest-alerts';
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
import { processNotificationQueue, type NotificationQueueResult } from '@/services/notification-dispatch';
import { cleanupExpiredAlerts, type AlertExpiryCleanupResult } from '@/services/alert-expiry';
import { sendEmail } from '@/services/email';
import { mapWithConcurrencyLimit } from '@/lib/with-concurrency';
import {
  runRefreshStep,
  retryFailedRefreshSteps,
  resolveRefreshRunStatus,
  CHAIN_RETRY_MAX_ATTEMPTS,
  sanitizeRefreshStepLoadError,
  summarizeStep,
  tryStartRefreshRun,
  finishRefreshRun,
  type RefreshStepOutcome,
  type RefreshStepSummary,
} from '@/services/refresh-run';
import { env } from '@/lib/config/env';
import { logger } from '@/lib/config/logger';
import {
  shouldRecordAvailabilitySnapshot,
  isBackInStockTransition,
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
  // Section 20, §12 #56 — admin-session fallback, the same pattern
  // /api/v1/predictions/outcomes and /api/v1/monitoring/uptime/check
  // already use: a signed-in admin may trigger a manual refresh
  // from /admin/refresh-runs without the cron secret. Cron
  // (Bearer <redacted> is still checked first and unchanged; the
  // scheduled cron-job.org call is unaffected. When CRON_SECRET is
  // unset AND there is no admin session, the original
  // "not configured" error is preserved.
  if (!isCronAuthorized(request)) {
    const admin = await requireAdmin(request);
    if ('error' in admin) {
      if (!process.env.CRON_SECRET) {
        // Final 100%, F-P2-55 — log the config failure server-side
        // (was unwired: the 500 went out with no error-log row).
        logApiError(new Error('CRON_SECRET is not configured'), {
          request,
          route: 'prices.refresh',
          status: 500,
        });
        return internalError(
          'CRON_SECRET is not configured; set it in the hosting dashboard before scheduling this endpoint'
        );
      }
      return admin.error;
    }
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    // Final 100%, F-P2-55 — see above.
    logApiError(new Error('SUPABASE_SERVICE_ROLE_KEY is not configured'), {
      request,
      route: 'prices.refresh',
      status: 500,
    });
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
    // Final 100%, F-P2-55 — a guard READ error is a real failure
    // (the run was not started); log it, don't just skip silently.
    if (guard.reason === 'guard-error') {
      logApiError(new Error(guard.error ?? 'Refresh guard could not be read'), {
        request,
        route: 'prices.refresh',
        status: 500,
      });
    }
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
    currencyAssumedUsd: 0,
    nonUsdCurrencies: [],
    loadFailed: false,
    staleFlipped: 0,
    suspiciousPriceChanges: 0,
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
    skippedUnknownCurrencyCurrencies: [],
    failed: 0,
    budgetExhausted: false,
    budgetRefunded: 0,
    // Final 100% — F-P2-19: the eBay/history design decision
    // travels on the zero/fallback result too, so the refresh
    // response always states it.
    historyNote: EBAY_PRICE_HISTORY_NOTE,
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
    skippedStale: 0,
    failed: 0,
    wishlistChecked: 0,
    wishlistTriggered: 0,
    wishlistQueued: 0,
    skippedExpired: 0,
  };
  // Sections 21–25, Stage F (F6) — alert-expiry cleanup step.
  // Deactivates (never deletes) expired alerts before the alerts
  // step fires new ones. A missing expires_at column (063
  // unapplied) is a clean skip carried in `skipped`, never a
  // failure — the step never throws.
  const zeroAlertExpiry: AlertExpiryCleanupResult = {
    alertsDeactivated: 0,
    guestAlertsDeactivated: 0,
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
  const zeroNotifications: NotificationQueueResult = { processed: 0, sent: 0, failed: 0, partial: 0 };
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
    skippedStale: 0,
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
  //
  //   Sections 21–25, Stage D (item 5) — CHAIN-LEVEL RETRY: the
  //   outcome bindings below are `let`, not `const`, so the retry
  //   pass after wave E can replace a failed step's outcome with
  //   its re-run. One retry, after a 2s backoff, failed steps
  //   only, in wave order — see `retryFailedRefreshSteps`
  //   (services/refresh-run.ts) and the rerun switch below.
  let ebay = await runRefreshStep(
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
  let pipeline = await runRefreshStep(
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
  let [refresh, stock] = await Promise.all([
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
  let [alertExpiry, alerts, hunts, digest, savedSearches, outcomes] = await Promise.all([
    // Sections 21–25, Stage F (F6) — deactivate expired alerts
    // FIRST in wave C, before checkPriceAlerts fires new ones.
    // Runs concurrently with the other wave-C steps; the checker's
    // own defensive skip covers any alert expiring mid-wave, so
    // the race is harmless either way.
    runRefreshStep(
      'cleanupExpiredAlerts',
      () => cleanupExpiredAlerts(supabase),
      zeroAlertExpiry
    ),
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
  let [notifications, guestAlerts] = await Promise.all([
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
  let guestEmail = await runRefreshStep(
    'drainGuestNotificationQueue',
    () => drainGuestNotificationQueue(supabase),
    zeroGuestEmail
  );

  // Sections 21–25, Stage D (item 5) — CHAIN-LEVEL RETRY.
  // Per-step isolation already keeps a failed step from killing
  // the chain, but a failed wave was never retried: a transient
  // DB blip failed the step for the whole 6h cycle. Failed steps
  // are now re-run ONCE, after a 2s backoff, in wave order
  // (ebay → pipeline → refresh → stock → alertExpiry → alerts → hunts →
  // digest → notifications → guestAlerts → guestEmail →
  // savedSearches → outcomes). Bounded: max 2 attempts per step
  // per run (`CHAIN_RETRY_MAX_ATTEMPTS`); recorded: retried steps
  // carry `attempts: 2` in the stored step summary, and the
  // response carries `chainRetry`. Safe: every step is
  // change-only / idempotent, so a re-run cannot double-record a
  // price, double-queue an alert, or double-send a digest.
  // LIMIT: retried wave-B/C steps reuse the first pass's
  // `sharedReads` — a wave-A step that recovers on retry writes
  // new prices that wave B already ran on; those prices are
  // picked up by the NEXT scheduled run, not by re-running wave
  // B here. A re-run of wave B would need fresh shared reads,
  // which is a bigger refactor than this bounded retry.
  const outcomeByStepName = (): Record<string, { status: string }> => ({
    ebay,
    pipeline,
    refresh,
    stock,
    alertExpiry,
    alerts,
    hunts,
    digest,
    notifications,
    guestAlerts,
    guestEmail,
    savedSearches,
    outcomes,
  });
  const stepOrder = [
    'ebay',
    'pipeline',
    'refresh',
    'stock',
    'alertExpiry',
    'alerts',
    'hunts',
    'digest',
    'notifications',
    'guestAlerts',
    'guestEmail',
    'savedSearches',
    'outcomes',
  ] as const;
  type RefreshStepName = (typeof stepOrder)[number];
  const failedFirstPass = stepOrder.filter(
    (name) => outcomeByStepName()[name].status === 'failed'
  );
  let chainRetry: {
    attempted: boolean;
    retriedSteps: string[];
    recoveredSteps: string[];
    stillFailedSteps: string[];
    maxAttempts: number;
  } = {
    attempted: false,
    retriedSteps: [],
    recoveredSteps: [],
    stillFailedSteps: [],
    maxAttempts: CHAIN_RETRY_MAX_ATTEMPTS,
  };
  if (failedFirstPass.length > 0) {
    // The rerun mirrors the wave calls above exactly (same step
    // function, same zero fallback, same isFailed predicate) and
    // replaces the failed outcome binding. guestAlerts reads the
    // CURRENT stock outcome, so a recovered stock retry feeds a
    // retried guestAlerts step.
    const rerunStep = async (
      name: RefreshStepName
    ): Promise<RefreshStepOutcome<unknown> | null> => {
      switch (name) {
        case 'ebay':
          ebay = await runRefreshStep('refreshEbayPrices', () => refreshEbayPrices(supabase), zeroEbay);
          return ebay;
        case 'pipeline':
          pipeline = await runRefreshStep('refreshPricesViaPipeline', () => refreshPricesViaPipeline(supabase), zeroPipeline);
          return pipeline;
        case 'refresh':
          refresh = await runRefreshStep(
            'refreshTrackedPrices',
            () => refreshTrackedPrices(supabase, sharedReads),
            zeroRefresh,
            (r) => (r.loadFailed ? (r.loadError ?? 'price load failed') : null)
          );
          return refresh;
        case 'stock':
          stock = await runRefreshStep(
            'recordAvailabilitySnapshots',
            () => recordAvailabilitySnapshots(supabase, sharedReads),
            zeroStock,
            (r) => (r.loadFailed ? (r.loadError ?? 'availability load failed') : null)
          );
          return stock;
        case 'alertExpiry':
          alertExpiry = await runRefreshStep(
            'cleanupExpiredAlerts',
            () => cleanupExpiredAlerts(supabase),
            zeroAlertExpiry
          );
          return alertExpiry;
        case 'alerts':
          alerts = await runRefreshStep('checkPriceAlerts', () => checkPriceAlerts(supabase), zeroAlerts);
          return alerts;
        case 'hunts':
          hunts = await runRefreshStep('runHuntsForConsentedUsers', () => runHuntsForConsentedUsers(supabase), zeroHunts);
          return hunts;
        case 'digest':
          digest = await runRefreshStep(
            'generateWeeklyDigestsForPremiumUsers',
            () => generateWeeklyDigestsForPremiumUsers(supabase),
            zeroDigest,
            (r) => r.error ?? null
          );
          return digest;
        case 'notifications':
          notifications = await runRefreshStep('processNotificationQueue', () => processNotificationQueue(supabase), zeroNotifications);
          return notifications;
        case 'guestAlerts':
          guestAlerts = await runRefreshStep(
            'checkGuestEmailAlerts',
            () => checkGuestEmailAlerts(supabase, new Set(stock.result.backInStock), sharedReads),
            zeroGuestAlerts
          );
          return guestAlerts;
        case 'guestEmail':
          guestEmail = await runRefreshStep('drainGuestNotificationQueue', () => drainGuestNotificationQueue(supabase), zeroGuestEmail);
          return guestEmail;
        case 'savedSearches':
          savedSearches = await runRefreshStep(
            'notifySavedSearchMatches',
            () => notifySavedSearchMatches(supabase),
            zeroSavedSearches,
            (r) => (r.ok || r.reason === 'table-missing' ? null : (r.reason ?? 'saved-search match notifications failed'))
          );
          return savedSearches;
        case 'outcomes':
          outcomes = await runRefreshStep(
            'resolvePendingPredictionOutcomes',
            () => resolvePendingPredictionOutcomes(supabase),
            zeroOutcomes,
            (r) => (r.ok || r.reason === 'table-missing' ? null : (r.reason ?? 'prediction outcome resolution failed'))
          );
          return outcomes;
        default:
          return null;
      }
    };
    const retryResult = await retryFailedRefreshSteps(
      [...failedFirstPass],
      (name) => rerunStep(name as RefreshStepName)
    );
    chainRetry = {
      attempted: true,
      retriedSteps: retryResult.retried,
      recoveredSteps: retryResult.recovered,
      stillFailedSteps: retryResult.stillFailed,
      maxAttempts: CHAIN_RETRY_MAX_ATTEMPTS,
    };
  }

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
      // Final 100% — F-P2-15: the suspicious-flag notification
      // count, stored in the run row (see RefreshStepCounts).
      suspiciousPriceChanges: refresh.result.suspiciousPriceChanges,
    }),
    alertExpiry: summarizeStep(alertExpiry, {
      processed: alertExpiry.result.alertsDeactivated + alertExpiry.result.guestAlertsDeactivated,
      succeeded: alertExpiry.result.alertsDeactivated + alertExpiry.result.guestAlertsDeactivated,
      failed: 0,
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
  // Sections 21–25, Stage D (item 5) — a step the chain retry
  // re-ran carries `attempts: 2` in the stored run record, so the
  // retry is visible in /admin/refresh-runs instead of looking
  // like a first-pass success.
  for (const name of chainRetry.retriedSteps) {
    if (steps[name]) steps[name].attempts = CHAIN_RETRY_MAX_ATTEMPTS;
  }
  const failedSteps = Object.entries(steps).filter(
    ([, s]) => s.status === 'failed'
  );
  // FINAL 100% (F-P1-28, K10b) — the overall status is computed
  // by the single shared rule (services/refresh-run.ts): a run
  // with zero failed steps but zero LIVE prices fetched is
  // 'completed_no_live_source', never 'completed'. Live prices
  // are eBay listings upserted from a real Browse response +
  // pipeline products with a fresh provider point; the refresh
  // step's DB re-reads are NOT live fetches and never count. The
  // old computation (no failed steps → 'completed') recorded a
  // no-provider run as a successful refresh; the header note
  // above ("must not report completed_with_failures just because
  // no live merchant adapter is configured yet") still holds —
  // this is a distinct status, not a failure.
  const livePricesFetched =
    ebay.result.updated + ebay.result.inserted + pipeline.result.refreshed;
  const overallStatus = resolveRefreshRunStatus({
    failedSteps: failedSteps.length,
    totalSteps: Object.keys(steps).length,
    livePricesFetched,
  });

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
    // FINAL 100% (F-P1-28) — the run's overall status rides in
    // the response too (it used to live only in the stored run
    // row), so the cron caller can see a no-live-source run
    // without reading the run table.
    status: overallStatus,
    livePricesFetched,
    ebay: ebay.result,
    pipeline: pipeline.result,
    refresh: refresh.result,
    alertExpiry: alertExpiry.result,
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
    // Sections 21–25, Stage D (item 5) — the chain-level retry
    // record: whether a retry happened, which steps were
    // retried, which recovered, and which still failed.
    chainRetry,
  });
}
