/**
 * Admin price-refresh runs page (Section 17, Stage F, item 27) —
 * /admin/refresh-runs.
 *
 * Shows the recorded refresh runs from `price_refresh_runs`
 * (migration 040): the last refresh time, each run's overall
 * status, and the failed steps inside each run (with the error the
 * chain recorded). Reads through the service-role client — the
 * table has no anon/authenticated write policies and runs are
 * written only by the refresh chain.
 *
 * Guard: /admin/layout.tsx already redirects non-admins
 * server-side before this page renders.
 *
 * Honesty:
 * - Migration 040 unapplied → the table does not exist, and the
 *   page says so ("no run records yet — migration 040 not
 *   applied") instead of erroring. Refresh runs proceed unguarded
 *   and unrecorded until the owner applies it.
 * - Table exists but no runs yet → "No refresh runs recorded yet."
 * - A run with no failed steps says "All steps ok" — never a
 *   claim about steps that were not recorded.
 * - Failed products (Section 18, item 47): per-product failures
 *   are stored with their reason in `error_log`
 *   (`route='prices.refresh'`, migration 048) by
 *   `markProductRefreshFailed` and listed below the runs. Until
 *   048 is applied the reason is not stored anywhere — the section
 *   says so instead of showing an empty list as if no product ever
 *   failed.
 * - Dead-lettered jobs (Section 18, item 42): the in-memory DLQ
 *   from `lib/workers/queue` is listed at the bottom with the
 *   queue metrics. It is per-instance state — "No dead-lettered
 *   jobs on this instance" says nothing about other instances.
 *
 * Monitor contract (documented here, NOT in the refresh route —
 * another worker owns that file): POST /api/v1/prices/refresh
 * always answers HTTP 200 with per-step statuses in the body. A
 * failed step never changes the status code, so a monitor that
 * checks the status alone will miss it — read the body, or read
 * this page.
 */

import type { Metadata } from 'next';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getDeadLetterQueue, getQueueMetrics } from '@/lib/workers/queue';
import {
  listRefreshRuns,
  failedStepsOf,
  refreshStepLabel,
} from '@/services/refresh-runs-admin';
import { listRefreshFailures } from '@/services/error-log-admin';
import type { RefreshRunRow } from '@/services/refresh-run';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Price refresh runs — Admin — SmartBuy AI',
  description:
    'Recorded price refresh runs: last refresh time and failed steps per run. Admin only.',
  robots: {
    index: false,
    follow: false,
  },
};

const RUN_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  completed_with_failures: 'Completed with failures',
  failed: 'Failed',
  running: 'Running',
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

export default async function AdminRefreshRunsPage() {
  const service = createSupabaseServiceClient();

  if (!service) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold">Price refresh runs</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so recorded refresh runs cannot be
          read. Set SUPABASE_SERVICE_ROLE_KEY in the hosting dashboard.
        </p>
      </main>
    );
  }

  const { runs, tableMissing, error } = await listRefreshRuns(service, 50);
  const failures = await listRefreshFailures(service, 20);
  const lastRun: RefreshRunRow | null = runs[0] ?? null;
  const totalFailedSteps = runs.reduce((n, run) => n + failedStepsOf(run).length, 0);
  // Section 18, item 42 — the in-memory dead-letter queue, surfaced
  // here because it had no callers and failed jobs surfaced nowhere.
  // Module state only: getQueue() is NOT called at import, and
  // importing this page never starts a worker. The numbers are for
  // THIS server instance only — Vercel runs several, and a DLQ entry
  // on another instance does not appear here.
  const deadLettered = getDeadLetterQueue();
  const queueMetrics = getQueueMetrics();

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold">Price refresh runs</h1>
      <p className="mt-2 text-muted-foreground">
        One row per refresh run, newest first — overall status and the steps that
        failed inside each run.
      </p>

      {/* Monitor contract: the refresh endpoint always answers HTTP 200 — a
          failed step lives in the per-step status, never in the status code. */}
      <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950">
        Monitoring note: POST /api/v1/prices/refresh always answers HTTP 200 with
        per-step statuses in the response body. A failed step never changes the
        status code — monitors must read the body (or this page), not the status
        alone, or a failed step will look like a success.
      </p>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Refresh runs could not be read: {error}
        </p>
      ) : tableMissing ? (
        <div className="mt-6 rounded-lg border p-6">
          <p className="font-medium">No run records yet — migration 040 not applied.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The price_refresh_runs table does not exist yet. Until the owner applies
            migration 040 (supabase/migrations/20261112093000_040_price_refresh_runs.sql)
            in the Supabase SQL Editor, refresh runs proceed unguarded and unrecorded,
            and there is nothing to list here. No run has been lost — none was ever
            stored.
          </p>
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-6 rounded-lg border p-6">
          <p className="font-medium">No refresh runs recorded yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The table exists, but no refresh run has been recorded since it was
            applied. The next scheduled refresh will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 rounded-lg border p-6">
            <p className="text-sm text-muted-foreground">Last refresh</p>
            <p className="mt-1 text-xl font-bold">
              {lastRun ? formatDateTime(lastRun.started_at) : '—'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {lastRun
                ? `Status: ${RUN_STATUS_LABELS[lastRun.status] ?? lastRun.status} · Source: ${lastRun.source} · ${totalFailedSteps} failed step${totalFailedSteps === 1 ? '' : 's'} across the last ${runs.length} run${runs.length === 1 ? '' : 's'}`
                : ''}
            </p>
          </div>

          <div className="mt-6 space-y-4">
            {runs.map((run) => {
              const failed = failedStepsOf(run);
              return (
                <section key={run.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {formatDateTime(run.started_at)}
                      {run.finished_at ? ` — ${formatDateTime(run.finished_at)}` : ' (still running)'}
                    </p>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                      {RUN_STATUS_LABELS[run.status] ?? run.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Source: {run.source}
                    {run.error ? ` · Run error: ${run.error}` : ''}
                  </p>
                  {failed.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">All steps ok.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-sm">
                      {failed.map((step) => (
                        <li key={step.name} className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-950">
                          <span className="font-medium">
                            Failed step: {refreshStepLabel(step.name)}
                          </span>
                          {step.error ? <span className="block text-muted-foreground">{step.error}</span> : null}
                          {step.counts ? (
                            <span className="block text-muted-foreground">
                              Processed {step.counts.processed} · succeeded {step.counts.succeeded} · failed {step.counts.failed}
                              {step.counts.skipped !== undefined ? ` · skipped ${step.counts.skipped}` : ''}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {/* Failed products with reasons (Section 18, item 47) — read
          from error_log, independent of the runs table above, so it
          renders even when migration 040 is unapplied. */}
      <h2 className="mt-10 text-xl font-semibold">Failed products</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Products whose last refresh failed, newest first, with the reason
        the refresh recorded. A failed product is re-queued after 15 minutes.
      </p>
      {failures.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Failed products could not be read: {failures.error}
        </p>
      ) : failures.tableMissing ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">Failure reasons are not stored yet — migration 048 not applied.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The error_log table does not exist yet. Until the owner applies
            migration 048 (supabase/migrations/20261112210000_048_error_log.sql)
            in the Supabase SQL Editor, a failed product is only marked
            failed and re-queued — the reason it failed is not stored
            anywhere. No failure has been lost — none was ever stored.
          </p>
        </div>
      ) : failures.failures.length === 0 ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">No failed products recorded.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The table exists, but no product refresh has failed since it was
            applied.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {failures.failures.map((failure) => (
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

      {/* Dead-letter queue (Section 18, item 42) — jobs that
          exhausted their retries on THIS server instance. The
          queue_metrics / sync_history tables are always empty (the
          metrics snapshot only runs from process(), which has no
          callers), so this in-memory list is the only place a
          failed job surfaces. Empty is the honest state when there
          is nothing dead-lettered on this instance — it says
          nothing about other instances. */}
      <h2 className="mt-10 text-xl font-semibold">Dead-lettered jobs</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Queue on this instance: {queueMetrics.enqueued} enqueued · {queueMetrics.completed} completed · {queueMetrics.failed} failed · {queueMetrics.deadLetterCount} dead-lettered.
      </p>
      {deadLettered.length === 0 ? (
        <div className="mt-4 rounded-lg border p-6">
          <p className="font-medium">No dead-lettered jobs on this instance.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            No job has exhausted its retries on this server instance since it
            started. Jobs that failed on another instance do not appear here.
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
