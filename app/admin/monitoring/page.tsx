/**
 * Admin monitoring page — /admin/monitoring (Sections 21–25,
 * Stage G; audit §4: alert-delivery + background-job monitoring
 * were MISSING).
 *
 * Two read-only sections, no actions, nothing enqueued or sent:
 * - Alert delivery: `notification_queue` (signed-in), guest
 *   notification queue, and digest failures — newest first, with
 *   status counts. A missing table says so instead of showing an
 *   empty list as if nothing was ever queued.
 * - Background jobs: the in-memory queue state on THIS instance
 *   (metrics, dead-letter queue, last-100 job outcomes). The
 *   page states plainly that this is per-instance state, lost on
 *   redeploy/restart, and that a job handed to an async worker
 *   would never record an outcome here (no such worker exists
 *   today — BullMQ is not installed).
 *
 * Guard: /admin/layout.tsx redirects non-admins server-side
 * before this page renders. The data services ALSO re-check the
 * admin role (G-P1-4 defense in depth) with the user id read
 * here — if there is no session user this page redirects to
 * sign-in instead of reading unguarded.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  getBackgroundJobStatus,
  listAlertDeliveries,
  listDigestFailures,
  listGuestAlertDeliveries,
} from '@/services/admin-monitoring';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Monitoring — Admin — SmartBuy AI',
  description: 'Alert delivery and background job monitoring. Admin only.',
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

export default async function AdminMonitoringPage({
  searchParams,
}: {
  searchParams?: { status?: string; channel?: string };
}) {
  const sessionClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) redirect('/sign-in?reason=session-expired');

  const service = createSupabaseServiceClient();
  if (!service) {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold">Monitoring</h1>
        <p className="mt-4 text-muted-foreground">
          The service-role key is not configured, so delivery and job
          records cannot be read. Set SUPABASE_SERVICE_ROLE_KEY in
          the hosting dashboard.
        </p>
      </main>
    );
  }

  const status = searchParams?.status;
  const channel = searchParams?.channel;
  const [signedIn, guest, digest, jobs] = await Promise.all([
    listAlertDeliveries(service, { adminUserId: user.id, limit: 50, status, channel }),
    listGuestAlertDeliveries(service, { adminUserId: user.id, limit: 50, status }),
    listDigestFailures(service, { adminUserId: user.id, limit: 50 }),
    Promise.resolve(getBackgroundJobStatus()),
  ]);

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold">Monitoring</h1>
      <p className="mt-2 text-muted-foreground">
        Alert delivery and background jobs — read-only. Nothing on
        this page sends, retries, or re-queues anything.
      </p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Delivery status</span>
          <select name="status" defaultValue={status ?? ''} className="rounded border px-2 py-1">
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Channel (signed-in queue)</span>
          <select name="channel" defaultValue={channel ?? ''} className="rounded border px-2 py-1">
            <option value="">All channels</option>
            <option value="email">Email</option>
            <option value="push">Push</option>
            <option value="in_app">In-app</option>
          </select>
        </label>
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          Apply filters
        </button>
        {(status || channel) && (
          <a href="/admin/monitoring" className="text-sm text-blue-600 hover:underline">
            Clear filters
          </a>
        )}
      </form>

      <h2 className="mt-10 text-xl font-semibold">Alert delivery — signed-in users</h2>
      {signedIn.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Alert deliveries could not be read: {signedIn.error}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {signedIn.counts.total} queued notifications in total —{' '}
            {signedIn.counts.pending} pending, {signedIn.counts.sent} sent,{' '}
            {signedIn.counts.failed} failed.
          </p>
          {signedIn.deliveries.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No queued notifications match the current filters.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {signedIn.deliveries.map((d) => (
                <li key={d.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{d.subject ?? d.type}</span>
                    <span className="text-xs text-muted-foreground">{d.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.type} · {d.channel} · scheduled {formatDateTime(d.scheduledFor)}
                    {d.sentAt ? ` · sent ${formatDateTime(d.sentAt)}` : ''}
                    {d.retryCount !== null && d.retryCount > 0 ? ` · retries ${d.retryCount}` : ''}
                  </div>
                  {d.lastError && (
                    <p className="mt-1 text-xs text-red-600">Last error: {d.lastError}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h2 className="mt-10 text-xl font-semibold">Alert delivery — guest email alerts</h2>
      {guest.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Guest alert deliveries could not be read: {guest.error}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {guest.counts.total} guest notifications in total —{' '}
            {guest.counts.pending} pending, {guest.counts.sent} sent,{' '}
            {guest.counts.failed} failed.
          </p>
          {guest.deliveries.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No guest notifications match the current filters.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {guest.deliveries.map((d) => (
                <li key={d.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{d.subject}</span>
                    <span className="text-xs text-muted-foreground">{d.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.email} · {d.createdAt ? formatDateTime(d.createdAt) : '—'}
                    {d.sentAt ? ` · sent ${formatDateTime(d.sentAt)}` : ''}
                  </div>
                  {d.errorMessage && (
                    <p className="mt-1 text-xs text-red-600">Error: {d.errorMessage}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h2 className="mt-10 text-xl font-semibold">Digest failures</h2>
      {digest.error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-800 dark:bg-red-950">
          Digest failures could not be read: {digest.error}
        </p>
      ) : digest.failures.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No digest failures recorded.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {digest.failures.map((f) => (
            <li key={f.id} className="rounded-lg border p-3 text-sm">
              <span className="font-medium">{f.reason}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {f.createdAt ? formatDateTime(f.createdAt) : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-xl font-semibold">Background jobs</h2>
      <p className="mt-2 text-sm text-muted-foreground">{jobs.note}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Mode</p>
          <p className="mt-1 text-2xl font-bold">{jobs.mode}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Enqueued</p>
          <p className="mt-1 text-2xl font-bold">{jobs.metrics.enqueued}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Completed / failed</p>
          <p className="mt-1 text-2xl font-bold">
            {jobs.metrics.completed} / {jobs.metrics.failed}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Dead-lettered</p>
          <p className="mt-1 text-2xl font-bold">{jobs.metrics.deadLetterCount}</p>
        </div>
      </div>
      <h3 className="mt-8 text-lg font-semibold">Dead-letter queue</h3>
      {jobs.deadLetter.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No dead-lettered jobs on this instance.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {jobs.deadLetter.map((entry) => (
            <li key={entry.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{entry.type}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.attempts} attempts · {formatDateTime(entry.failedAt)}
                </span>
              </div>
              <p className="mt-1 text-xs text-red-600">{entry.error}</p>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-8 text-lg font-semibold">Recent job outcomes (last 100, this instance)</h3>
      {jobs.recentJobs.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No synchronously-run job has recorded an outcome on this
          instance yet. A job handed to an async worker would never
          appear here (no such worker exists today — BullMQ is not
          installed).
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {jobs.recentJobs.map(({ jobId, result }) => (
            <li key={jobId} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{jobId}</span>
                <span className="text-xs text-muted-foreground">
                  {result.success ? 'completed' : 'failed'} · processed {result.processed}
                </span>
              </div>
              {result.errors && result.errors.length > 0 && (
                <p className="mt-1 text-xs text-red-600">{result.errors.join('; ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
