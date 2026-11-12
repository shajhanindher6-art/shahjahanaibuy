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
 * - Error logs: there is no error-log table or service in the repo,
 *   so the section says so and points at the Vercel logs.
 *
 * Server component; the layout already enforces the admin-only
 * guard. When the service-role key is unset the service client is
 * null and every section renders its unavailable state.
 */

import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getOwnerOverview } from '@/services/owner';

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
  const service = createSupabaseServiceClient();
  const overview = service ? await getOwnerOverview(service) : null;

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

              <h2 className="mt-10 text-xl font-semibold">Error logs</h2>
              <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
                There is no error-log store in the app — no table, no
                service — so this dashboard cannot show application errors.
                Errors surface in the Vercel deployment logs and in Sentry
                (when a DSN is configured). An in-app error log is a future
                build, not a silent empty table.
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
