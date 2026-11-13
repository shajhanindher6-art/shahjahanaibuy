/**
 * Admin ingestion-failure view (Section 20, §12 #71) —
 * /admin/ingestion-failures.
 *
 * Three fail-safe sources, newest first:
 * - error_log rows (migration 048): every recorded application
 *   error. While 048 is unapplied the table does not exist and the
 *   page says so instead of showing an empty list as if nothing
 *   ever failed.
 * - per-product refresh failures (route 'prices.refresh' in the
 *   same table) — the failed-products list /admin/refresh-runs
 *   already shows; repeated here so failures live in one place.
 * - recorded refresh runs (migration 040) and this instance's
 *   dead-lettered jobs — a failed run or an exhausted job is an
 *   ingestion failure too.
 *
 * Guard: /admin/layout.tsx redirects non-admins server-side.
 * All copy is literal English — no i18n keys are added.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getDeadLetterQueue, getQueueMetrics } from '@/lib/workers/queue';
import { listRecentErrors, listRefreshFailures } from '@/services/error-log-admin';
import { listIngestionRejections } from '@/services/ingestion-rejections';
import {
  failedStepsOf,
  listRefreshRuns,
  refreshStepLabel,
} from '@/services/refresh-runs-admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ingestion failures — Admin — SmartBuy AI',
  description: 'Recorded ingestion and refresh failures: error log, failed products, failed runs. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminIngestionFailuresPage() {
  const service = createSupabaseServiceClient();

  if (!service) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold">Ingestion failures</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so failures cannot be
          read. Set SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard.
        </p>
      </main>
    );
  }

  const errors = await listRecentErrors(service, 50);
  const refreshFailures = await listRefreshFailures(service, 20);
  const rejections = await listIngestionRejections(service, 50);
  const { runs, tableMissing: runsTableMissing, error: runsError } = await listRefreshRuns(service, 10);
  const deadLettered = getDeadLetterQueue();
  const queueMetrics = getQueueMetrics();

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold">Ingestion failures</h1>
      <p className="mt-2 text-muted-foreground">
        Recorded failures from the error log, per-product refresh
        failures, failed refresh runs, and dead-lettered jobs — newest
        first. An empty section means nothing was stored there, not
        that nothing ever failed.
      </p>

      <h2 className="mt-10 text-xl font-semibold">Rejected ingestion rows</h2>
      {rejections.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Rejected rows could not be read: {rejections.error}
        </p>
      ) : rejections.tableMissing ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">Rejected rows are not stored yet — migration 048 not applied.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Pipeline and CSV rejections are written to the same
            error_log table as the section above, so they are
            unavailable for the same reason. This is not a claim
            that no row was ever rejected.
          </p>
        </div>
      ) : rejections.rejections.length === 0 ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">No rejected rows recorded.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The table exists, but no pipeline or CSV rejection has
            been recorded since it was applied.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {rejections.rejections.map((rejection) => (
            <li key={rejection.id} className="rounded-lg border p-4 text-sm">
              <p className="font-medium">
                {rejection.productName ?? 'Unnamed row'}
                {rejection.rowNumber !== null ? ` · CSV row ${rejection.rowNumber}` : ''}
                {rejection.source ? ` · ${rejection.source}` : ''} ·{' '}
                {formatDateTime(rejection.created_at)}
              </p>
              <p className="mt-1 text-muted-foreground">{rejection.reason ?? rejection.message}</p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-xl font-semibold">Error log</h2>
      {errors.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Error log could not be read: {errors.error}
        </p>
      ) : errors.tableMissing ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">Error logging is not active yet — migration 048 not applied.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The error_log table does not exist yet. Until the owner
            applies migration 048
            (supabase/migrations/20261112210000_048_error_log.sql) in
            the Supabase SQL Editor, ingestion failures are only in
            the deployment logs — none was ever stored here. This is
            not a claim of zero failures.
          </p>
        </div>
      ) : errors.errors.length === 0 ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">No errors recorded.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The table exists, but no error has been recorded since it
            was applied. Most ingestion paths do not log into this
            table yet, so an empty log is partly a missing-writer gap,
            not proof nothing failed.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {errors.errors.map((row) => (
            <li key={row.id} className="rounded-lg border p-4 text-sm">
              <p className="font-medium">
                {row.level} · {row.route ?? 'unknown route'} · {formatDateTime(row.created_at)}
              </p>
              <p className="mt-1 text-muted-foreground">{row.message}</p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-xl font-semibold">Failed product refreshes</h2>
      {refreshFailures.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Failed products could not be read: {refreshFailures.error}
        </p>
      ) : refreshFailures.tableMissing ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">Failure reasons are not stored yet — migration 048 not applied.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Per-product refresh failures are written to the same
            error_log table, so they are unavailable for the same
            reason as the section above.
          </p>
        </div>
      ) : refreshFailures.failures.length === 0 ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">No failed product refreshes recorded.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {refreshFailures.failures.map((failure) => (
            <li key={failure.id} className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
              <p className="font-medium">
                {failure.productName ?? failure.productSlug ?? failure.productId}
              </p>
              <p className="mt-1 text-muted-foreground">
                {failure.reason ?? failure.message} · {formatDateTime(failure.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-xl font-semibold">Failed refresh runs</h2>
      {runsError ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Refresh runs could not be read: {runsError}
        </p>
      ) : runsTableMissing ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">No run records yet — migration 040 not applied.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The price_refresh_runs table does not exist yet, so runs
            proceed unguarded and unrecorded and no failed run can be
            listed here.
          </p>
        </div>
      ) : (
        (() => {
          const failedRuns = runs.filter((run) => failedStepsOf(run).length > 0 || run.status === 'failed');
          if (failedRuns.length === 0) {
            return (
              <div className="mt-4 rounded-lg border p-6">
                <p className="font-medium">No failed refresh runs in the last {runs.length} run(s).</p>
              </div>
            );
          }
          return (
            <ul className="mt-4 space-y-2">
              {failedRuns.map((run) => (
                <li key={run.id} className="rounded-lg border p-4 text-sm">
                  <p className="font-medium">
                    {formatDateTime(run.started_at)} · {run.status}
                  </p>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {failedStepsOf(run).map((step) => (
                      <li key={step.name}>
                        Failed step: {refreshStepLabel(step.name)}
                        {step.error ? ` — ${step.error}` : ''}
                      </li>
                    ))}
                  </ul>
                  {run.error ? <p className="mt-1 text-muted-foreground">Run error: {run.error}</p> : null}
                </li>
              ))}
            </ul>
          );
        })()
      )}

      <h2 className="mt-10 text-xl font-semibold">Dead-lettered jobs</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Queue on this instance: {queueMetrics.enqueued} enqueued · {queueMetrics.completed} completed · {queueMetrics.failed} failed · {queueMetrics.deadLetterCount} dead-lettered.
      </p>
      {deadLettered.length === 0 ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">No dead-lettered jobs on this instance.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            No job has exhausted its retries on this server instance
            since it started. Jobs that failed on another instance do
            not appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {deadLettered.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
              <p className="font-medium">
                {entry.type} · {entry.attempts} attempt{entry.attempts === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-muted-foreground">
                {entry.error} · {formatDateTime(entry.failedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
