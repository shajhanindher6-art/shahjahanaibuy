/**
 * Owner dashboard (Section 17, Stage H item 19).
 *
 * Revenue, subscriptions, API usage, price-source health, failed
 * jobs, error logs — read from existing tables/services only
 * (services/owner.ts). Honest empty states everywhere:
 *
 * - Revenue is $0, stated plainly with the reason: Stripe is in
 *   test mode and no paid plan can be bought today, so no live
 *   charge has ever been taken. The page never multiplies a plan
 *   price by a subscriber count.
 * - A missing table (migration not applied yet) renders "not
 *   recorded yet", never a zero presented as a measurement.
 * - Error logs: the most recent rows from `error_log`
 *   (migration 048, services/error-log-admin.ts). A missing table
 *   (migration not applied yet) renders "not applied yet", never a
 *   zero presented as a measurement — and an empty table renders
 *   "no errors recorded yet", which is the truth until a writer
 *   lands: no caller records errors into the table today
 *   (audit §1 #10), so an empty log is a missing writer, not a
 *   proven-clean app.
 *
 * Server component; the layout already enforces the admin-only
 * guard. When the service-role key is unset the service client is
 * null and every section renders its unavailable state.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getOwnerOverview } from '@/services/owner';
import { listRecentErrors } from '@/services/error-log-admin';
import { ErrorLogList } from '@/components/owner/error-log-list';
import { getAiAccuracySummary, accuracySummaryLine } from '@/services/ai-accuracy';
import { requireAdminPage } from '@/lib/admin-page-guard';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const REFRESH_RUN_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  completed_with_failures: 'Completed with failures',
  failed: 'Failed',
  running: 'Running',
};

export default async function OwnerPage() {
  // Final 100%, F-P1-62 — per-page server-side admin re-check
  // (the layout guard alone is not the only check anymore).
  await requireAdminPage();
  // Sections 21–25, Stage G, G-P1-4 — the error-log read service
  // re-checks the admin role itself (defense in depth, beyond the
  // owner layout guard), so the page passes the session user id.
  const sessionClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) redirect('/sign-in?reason=session-expired');

  const service = createSupabaseServiceClient();
  const overview = service ? await getOwnerOverview(service) : null;
  const errorLog = service ? await listRecentErrors(service, 20, { adminUserId: user.id }) : null;
  // Section 19, Phase 7 (§12 #72): the SAME accuracy computation
  // the /admin/ai control center shows (services/ai-accuracy) —
  // no second computation. Fail-safe while migration 032 is
  // unapplied: "no outcomes recorded yet", never a percentage.
  const aiAccuracy = service ? await getAiAccuracySummary(service) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-3xl font-bold">Owner dashboard</h1>
          <p className="mt-2 text-muted-foreground">
            Revenue, subscriptions, API usage, price-source health, failed
            jobs and error logs — from the live database only. Where the
            app has no record yet, the section says so instead of showing
            a zero.
          </p>

          {!service || !overview ? (
            <p className="mt-6 rounded-lg border border-dashed p-6 text-muted-foreground">
              Owner data is unavailable right now — the service-role key
              is not configured, so the dashboard cannot read rows across
              users. Set SUPABASE_SERVICE_ROLE_KEY in Vercel and this page
              fills in; nothing below is a measurement until then.
            </p>
          ) : (
            <>
              <h2 className="mt-10 text-xl font-semibold">Revenue</h2>
              <div className="mt-4 rounded-lg border p-6">
                <p className="text-4xl font-bold">$0</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Total revenue to date is $0. Stripe is in test mode and
                  no paid plan can be bought today — every paid tier is a
                  planned price, not a live charge — so no payment has ever
                  been taken.
                  {overview.subscriptions.activePaid !== null &&
                  overview.subscriptions.activePaid > 0
                    ? ` ${overview.subscriptions.activePaid} active paid-plan subscription(s) exist in the database, but with Stripe in test mode none of them is a live charge.`
                    : ''}
                </p>
              </div>

              <h2 className="mt-10 text-xl font-semibold">Subscriptions</h2>
              {overview.subscriptions.total === null ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  Subscription counts are unavailable — the subscriptions
                  table could not be read.
                </p>
              ) : (
                <div className="mt-4 rounded-lg border p-6">
                  <p className="text-muted-foreground">
                    {overview.subscriptions.total} subscription(s) recorded
                    ({overview.subscriptions.active} active
                    {overview.subscriptions.activePaid !== null
                      ? `, ${overview.subscriptions.activePaid} on a paid plan`
                      : ''}
                    ).
                  </p>
                  {Object.entries(overview.subscriptions.byPlan).length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {Object.entries(overview.subscriptions.byPlan)
                        .sort((a, b) => b[1] - a[1])
                        .map(([plan, count]) => (
                          <li key={plan}>
                            {plan}: {count}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No subscriptions recorded yet.
                    </p>
                  )}
                </div>
              )}

              <h2 className="mt-10 text-xl font-semibold">API usage</h2>
              {overview.apiUsage.tableMissing ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  No API usage has been recorded yet — the api_key_usage
                  ledger (migration 035) has not been applied, so the app
                  has no durable usage record. API keys:{' '}
                  {overview.apiUsage.totalKeys ?? 'unknown'}.
                </p>
              ) : (
                <div className="mt-4 rounded-lg border p-6">
                  <p className="text-muted-foreground">
                    {overview.apiUsage.callsLast7Days ?? 0} recorded API
                    calls in the last 7 days across{' '}
                    {overview.apiUsage.totalKeys ?? 0} API key(s).
                  </p>
                </div>
              )}

              <h2 className="mt-10 text-xl font-semibold">Price-source health</h2>
              {overview.priceSourceHealth.tableMissing ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  Price-source health is unavailable — the products table
                  could not be read.
                </p>
              ) : (
                <div className="mt-4 rounded-lg border p-6">
                  <p className="text-muted-foreground">
                    {overview.priceSourceHealth.totalProducts ?? 0} product(s)
                    across {overview.priceSourceHealth.totalMerchants ?? 0} merchant(s).
                    {overview.priceSourceHealth.latestFreshness
                      ? ` Latest recorded price freshness: ${formatDate(overview.priceSourceHealth.latestFreshness)}.`
                      : ' No recorded price-freshness stamp yet.'}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    The refresh fetches nothing live except the eBay leg
                    (blocked without eBay keys) — a freshness stamp means a
                    recorded price was re-checked, not live-checked. See{' '}
                    <Link href="/status" className="underline">
                      /status
                    </Link>{' '}
                    for the last refresh run.
                  </p>
                </div>
              )}

              <h2 className="mt-10 text-xl font-semibold">Failed jobs</h2>
              {overview.refreshHealth.tableMissing ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  No refresh run has been recorded yet — the
                  price_refresh_runs table (migration 040) has not been
                  applied, so the app has no record of failed steps. The
                  refresh chain itself reports per-step status in its
                  response body.
                </p>
              ) : overview.refreshHealth.latestRun ? (
                <div className="mt-4 rounded-lg border p-6">
                  <p className="text-muted-foreground">
                    Last refresh run: {formatDateTime(overview.refreshHealth.latestRun.started_at)} —{' '}
                    {REFRESH_RUN_STATUS_LABELS[overview.refreshHealth.latestRun.status] ??
                      overview.refreshHealth.latestRun.status}
                    .
                  </p>
                  {overview.refreshHealth.latestFailedSteps.length > 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Steps that failed in this run:{' '}
                      {overview.refreshHealth.latestFailedSteps.join(', ')}.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No step failed in the last run.
                    </p>
                  )}
                  <p className="mt-2 text-sm">
                    <Link href="/admin/refresh-runs" className="underline">
                      Full refresh-run history in /admin
                    </Link>
                  </p>
                </div>
              ) : (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  No refresh run has been recorded yet.
                </p>
              )}

              <h2 className="mt-10 text-xl font-semibold">Uptime</h2>
              {overview.uptimeHealth.tableMissing ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  No uptime checks have been recorded yet — the
                  uptime_checks table (migration 032) has not been applied.
                </p>
              ) : (
                <div className="mt-4 rounded-lg border p-6">
                  <p className="text-muted-foreground">
                    {overview.uptimeHealth.totalChecks ?? 0} recorded check(s)
                    {overview.uptimeHealth.lastCheckAt
                      ? `, last ${formatDateTime(overview.uptimeHealth.lastCheckAt)} — ${overview.uptimeHealth.lastCheckOk ? 'passed' : 'failed'}.`
                      : '.'}
                  </p>
                </div>
              )}

              <h2 className="mt-10 text-xl font-semibold">AI prediction accuracy</h2>
              {!aiAccuracy ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  Prediction accuracy is unavailable — the service-role key
                  is not configured, so the dashboard cannot read the
                  recorded outcomes.
                </p>
              ) : aiAccuracy.error ? (
                <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
                  Prediction accuracy could not be read: {aiAccuracy.error}
                </p>
              ) : aiAccuracy.tableMissing ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  No prediction outcomes recorded yet — the
                  prediction_outcomes table (migration 032) has not been
                  applied, so no accuracy can be measured. An accuracy
                  percentage is published only once 20 outcomes have
                  resolved; until then there is no number to show.
                </p>
              ) : (
                <div className="mt-4 rounded-lg border p-6">
                  {aiAccuracy.summary.accuracyPercent !== null ? (
                    <p className="text-4xl font-bold">
                      {aiAccuracy.summary.accuracyPercent}%
                    </p>
                  ) : (
                    <p className="text-2xl font-bold">No accuracy percentage yet</p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {accuracySummaryLine(aiAccuracy.summary)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {aiAccuracy.summary.totalRecorded} outcome(s) recorded —{' '}
                    {aiAccuracy.summary.resolved} resolved,{' '}
                    {aiAccuracy.summary.pending} still waiting for their
                    horizon to pass, {aiAccuracy.summary.expired} expired.
                    Same figures as the AI control center in /admin/ai.
                  </p>
                </div>
              )}

              <h2 className="mt-10 text-xl font-semibold">Error logs</h2>
              {!errorLog ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  Error logs are unavailable — the service-role key is not
                  configured, so the dashboard cannot read the error log.
                </p>
              ) : errorLog.error ? (
                <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
                  Error logs could not be read: {errorLog.error}
                </p>
              ) : errorLog.tableMissing ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  No error-log records yet — the error_log table
                  (migration 048) has not been applied. Until the owner
                  applies migration 048
                  (supabase/migrations/20261112210000_048_error_log.sql)
                  in the Supabase SQL Editor, errors surface in the
                  Vercel deployment logs and in Sentry (when a DSN is
                  configured). No error has been lost — none was ever
                  stored in-app.
                </p>
              ) : errorLog.errors.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                  No errors recorded yet. The table exists and API
                  errors are written to it — an empty log means no
                  error has been recorded since it was applied.
                </p>
              ) : (
                <ErrorLogList errors={errorLog.errors} />
              )}
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
