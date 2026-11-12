/**
 * Price alert checker (cron endpoint).
 * POST /api/v1/alerts/check — one scheduled run of the full chain:
 *
 *   1. refreshTrackedPrices(): record any changed catalog price for
 *      alerted / wishlisted products as a new price_history row.
 *   2. checkPriceAlerts(): compare active alerts with the new prices
 *      and queue notifications for triggered alerts.
 *   3. processNotificationQueue(): drain the queue, sending email
 *      (Resend), web push (VAPID), and WhatsApp/Telegram webhook
 *      alerts for every enabled channel.
 *
 * SINGLE-SCHEDULER RULE (see docs/alerts-delivery-setup.md): schedule
 * exactly ONE trigger — POST /api/v1/prices/refresh from one free
 * cron job (e.g. cron-job.org). This endpoint exists so that either
 * endpoint alone covers the whole chain (useful for a manual run or
 * a health check), but scheduling BOTH endpoints, or additionally
 * scheduling the Supabase price-refresh-worker Edge Function, would
 * run the chain twice per cadence. Pick ONE, never both.
 *
 * Section 15, P1-1 — PER-STEP ISOLATION (same as /prices/refresh):
 * every step runs through runRefreshStep() in its own try/catch, so
 * a throwing step is recorded as `steps.<name>.status: 'failed'`
 * with its error, its counts fall back to zero, and the chain
 * continues — the handler always returns 200 with per-step results.
 *
 * Section 15, P1-7 — ONE RUN AT A TIME: the shared
 * tryStartRefreshRun() guard (price_refresh_runs, migration 040)
 * skips this run with 200 + `skipped: true` when a refresh is
 * already in progress from any trigger. Fails open while migration
 * 040 is unapplied.
 *
 * Section 15, P1-5 — RUN RECORD: one row per run is written to
 * price_refresh_runs and read by /status.
 *
 * Protected by CRON_SECRET: the secret must be set in the hosting
 * dashboard, and the caller must send `Authorization: Bearer
 * <CRON_SECRET>`. When CRON_SECRET is unset the endpoint refuses to
 * run (fail closed) instead of accepting unauthenticated trigger
 * calls. Uses the service-role client because the refresh and
 * checker must read alerts and wishlist items belonging to every
 * user; the owner-scoped RLS policies would hide other users' rows
 * from an anon/authenticated client.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard. If it
 * is not set, the endpoint returns a clear error instead of running
 * as anon and silently checking zero alerts.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, unauthorized, internalError } from '@/lib/api/responses';
import { logApiRequest, rateLimitResponse, getClientIp } from '@/lib/api/middleware';
import { isCronAuthorized } from '@/lib/api/cron-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refreshTrackedPrices, type PriceRefreshResult } from '@/services/price-refresh';
import { checkPriceAlerts, type AlertCheckResult } from '@/services/alert-checker';
import { processNotificationQueue } from '@/services/notification-dispatch';
import {
  runRefreshStep,
  summarizeStep,
  tryStartRefreshRun,
  finishRefreshRun,
  type RefreshStepSummary,
} from '@/services/refresh-run';

/**
 * Section 18, item 36 — `maxDuration` (see
 * app/api/v1/notifications/process/route.ts for the plan
 * constraint): Vercel Hobby caps serverless execution at 60s —
 * DO NOT raise without a paid plan.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'alerts.check' });
  // Rate limit: 30 requests/min per IP (see docs/rate-limits.md).
  const limited = await rateLimitResponse(`alerts.check:${getClientIp(request)}`, 30);
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
      'SUPABASE_SERVICE_ROLE_KEY is not configured; alert checking requires the service-role client'
    );
  }

  // Section 15, P1-7 — one run at a time, across all triggers.
  // When another run is in progress this call skips (200 +
  // skipped: true) instead of duplicating the chain. Section 18,
  // item 35 — the guard fails open ONLY while migration 040 is
  // unapplied (missing table); a guard error fails safe (run not
  // started, reason 'guard-error'), never unguarded.
  const guard = await tryStartRefreshRun(supabase, 'alerts-check');
  if (!guard.started) {
    const skipMessage =
      guard.reason === 'guard-error'
        ? 'The refresh guard could not be read — the run was not started.'
        : 'Another refresh run is in progress.';
    const steps: Record<string, RefreshStepSummary> = {
      refresh: { status: 'skipped', error: skipMessage },
      alerts: { status: 'skipped', error: skipMessage },
      notifications: { status: 'skipped', error: skipMessage },
    };
    return apiSuccess({
      skipped: true,
      reason: guard.reason ?? 'run-in-progress',
      error: guard.error,
      existingRunId: guard.existingRunId,
      steps,
    });
  }

  // Section 15, P1-1 — every step isolated: a throw (or a load
  // failure, P1-8) records `failed` with its error, keeps zeroed
  // fallback counts, and the chain continues. The handler always
  // returns 200 with per-step results.
  const zeroRefresh: PriceRefreshResult = {
    tracked: 0,
    inserted: 0,
    unchanged: 0,
    skippedNoRetailer: 0,
    skippedNoPrice: 0,
    failed: 0,
    loadFailed: false,
  };
  const zeroAlerts: AlertCheckResult = {
    checked: 0,
    triggered: 0,
    queued: 0,
    skippedDuplicate: 0,
    failed: 0,
  };
  const zeroNotifications = { processed: 0, sent: 0, failed: 0 };

  const refresh = await runRefreshStep(
    'refreshTrackedPrices',
    () => refreshTrackedPrices(supabase),
    zeroRefresh,
    (r) => (r.loadFailed ? (r.loadError ?? 'price load failed') : null)
  );
  const alerts = await runRefreshStep(
    'checkPriceAlerts',
    () => checkPriceAlerts(supabase),
    zeroAlerts
  );
  const notifications = await runRefreshStep(
    'processNotificationQueue',
    () => processNotificationQueue(supabase),
    zeroNotifications
  );

  // Section 18, item 38 — per-step counts in the stored steps
  // JSONB (same mapping as the prices/refresh route; nothing
  // invented — every count comes from the step's own result).
  const steps: Record<string, RefreshStepSummary> = {
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
    notifications: summarizeStep(notifications, {
      processed: notifications.result.processed,
      succeeded: notifications.result.sent,
      failed: notifications.result.failed,
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
    refresh: refresh.result,
    alerts: alerts.result,
    notifications: notifications.result,
    steps,
  });
}
