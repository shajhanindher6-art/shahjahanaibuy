/**
 * Public status page (Section 4, item 11; Section 9, chunk 4).
 *
 * Shows the overall status, uptime % over the last 90 days, and
 * incident history — all computed from recorded rows in
 * `uptime_checks` / `uptime_incidents` (migration 032) via
 * lib/status.ts. Honest states by design:
 * - Before any check is recorded: "Monitoring has not recorded any
 *   checks yet" and NO uptime % (never invented) — and no invented
 *   start date (Section 17, Stage H item 5 removed the hardcoded
 *   "10 November 2026" fallback; the start date is the first
 *   recorded check, or nothing is claimed).
 * - An empty incident list means no incidents have been recorded
 *   since monitoring started — not a claim about before then.
 * Fail-safe: if the migration has not been run, the page still
 * renders the "monitoring not started yet" state instead of erroring.
 *
 * The "Services & integrations" section is computed at request time
 * from services/platform-status.ts — real env-derived booleans and
 * counts (eBay configured or not, Skimlinks, Amazon locales, store
 * directory size), never a claim about a platform that is not
 * configured. The page deliberately does NOT claim an uptime %,
 * a cron-job state, or an external-monitor state it cannot check:
 * the owner's cron-job.org jobs and UptimeRobot monitor live outside
 * the app, so their running state is stated as unknown, not as up.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/layout/site-header';
import { PageJsonLd } from '@/components/seo/page-json-ld';
import { SiteFooter } from '@/components/layout/site-footer';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildStatusSummary, buildStatusSummaryFromUptime, fetchStatusUptime, type StatusIncident } from '@/lib/status';
import type { UptimeSummary } from '@/lib/uptime';
import { describePlatformStatus, type PlatformStatus } from '@/services/platform-status';
import { getLatestRefreshRun, type RefreshRunRow } from '@/services/refresh-run';
import { appConfig } from '@/lib/config/app';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Status — SmartBuy AI',
  description:
    'SmartBuy AI service status, uptime and incident history. Uptime is computed from recorded checks only.',
};

const STATUS_STYLES: Record<string, string> = {
  operational: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  degraded: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
  outage: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  unknown: 'bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  operational: 'All systems operational',
  degraded: 'Degraded',
  outage: 'Outage',
  unknown: 'Monitoring starting up',
};

// Same labels as the /platforms hub (services/platform-status.ts),
// so the two pages never disagree about a platform's state.
const PLATFORM_STATUS_LABELS: Record<PlatformStatus, string> = {
  live: 'Live',
  configured: 'Configured',
  'not-configured': 'Not configured',
  'search-links-only': 'Search links only',
};

const PLATFORM_STATUS_STYLES: Record<PlatformStatus, string> = {
  live: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  configured: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  'not-configured': 'bg-muted text-muted-foreground',
  'search-links-only': 'bg-muted text-muted-foreground',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Section 15, P1-5 — labels for the last recorded refresh run
// (price_refresh_runs, migration 040). A `running` row means a run
// started and has not finished yet.
const REFRESH_RUN_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  completed_with_failures: 'Completed with failures',
  failed: 'Failed',
  running: 'Running',
};

export default async function StatusPage() {
  let incidents: StatusIncident[] = [];
  // Section 15, P1-5: the latest recorded refresh run, or null when
  // no run has been recorded yet (migration 040 not applied, or no
  // run since it was applied). Fail-open by design — a missing
  // table renders the "no refresh recorded yet" state below, never
  // a 500.
  let lastRefresh: RefreshRunRow | null = null;
  // Section 18, item 29 — DB-side uptime summary (two head:true
  // counts + first/last check rows), or null when the read failed.
  let uptimeSummary: UptimeSummary | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    // The old code pulled up to 2,000 uptime_checks rows per visit
    // and summarized them in JS; fetchStatusUptime returns the
    // identical numbers with a fraction of the transfer.
    const [uptime, incidentsRes] = await Promise.all([
      fetchStatusUptime(supabase, 90),
      supabase
        .from('uptime_incidents')
        .select('id, started_at, resolved_at, title, status, description')
        .order('started_at', { ascending: false })
        .limit(50),
    ]);
    if (!incidentsRes.error && incidentsRes.data) {
      incidents = incidentsRes.data as unknown as StatusIncident[];
    }
    lastRefresh = await getLatestRefreshRun(supabase);
    uptimeSummary = uptime;
  } catch {
    // Fail-safe: render the honest "no data yet" state below.
  }

  // A null uptime (read failure) falls back to the empty summary —
  // the same "no data yet" state the page rendered before.
  const summary = uptimeSummary
    ? buildStatusSummaryFromUptime(uptimeSummary, incidents)
    : buildStatusSummary([], incidents, 90);
  const uptime = summary.uptime;
  // Real, request-time configuration state (env-derived booleans and
  // counts). A platform with no configured account reports
  // "Not configured" / "Search links only" here, never "Live".
  const platforms = describePlatformStatus();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {/* Section 16, item 14: page-level JSON-LD (WebPage + BreadcrumbList). */}
      <PageJsonLd
        name="Status"
        description="SmartBuy AI service status, uptime and incident history. Uptime is computed from recorded checks only."
        path="/status"
        crumbs={[ { name: "Home", path: "/" }, { name: "Status" } ]}
      />
      <main className="container mx-auto flex-1 px-4 py-12">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-3xl font-bold">Service status</h1>

          <div className="mt-6 rounded-lg border p-6">
            <span
              className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[summary.overall] ?? STATUS_STYLES.unknown}`}
            >
              {STATUS_LABELS[summary.overall] ?? summary.overall}
            </span>
            <p className="mt-3 text-muted-foreground">{summary.message}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {summary.monitoringStartedAt
                ? `Monitoring started ${formatDate(summary.monitoringStartedAt)}.`
                : 'Monitoring has not recorded any checks yet.'}
            </p>
          </div>

          <h2 className="mt-10 text-xl font-semibold">Services &amp; integrations</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Checked live on every visit — this is what the app itself can verify right now.
            See the{' '}
            <Link href="/platforms" className="underline">
              platforms hub
            </Link>{' '}
            for the same statuses with more detail.
          </p>
          <ul className="mt-4 space-y-4">
            {platforms.map((platform) => (
              <li key={platform.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium">{platform.name}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PLATFORM_STATUS_STYLES[platform.status]}`}
                  >
                    {PLATFORM_STATUS_LABELS[platform.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{platform.coverage}</p>
                <p className="mt-1 text-sm">{platform.whatYouGet}</p>
              </li>
            ))}
          </ul>

          <h2 className="mt-10 text-xl font-semibold">Last verified</h2>
          {/* Section 18, item 29 — the last check comes from the
              counts-based summary (lastCheckAt/lastOk/...), not a
              2,000-row pull; the values are identical. */}
          {uptime.lastCheckAt ? (
            <p className="mt-4 rounded-lg border p-6 text-muted-foreground">
              Last recorded check: {formatDateTime(uptime.lastCheckAt)} —{' '}
              {uptime.lastOk ? 'passed' : 'failed'}
              {uptime.lastStatusCode ? ` (HTTP ${uptime.lastStatusCode})` : ''}
              {uptime.lastTargetUrl ? ` on ${uptime.lastTargetUrl}` : ''}. This
              is the most recent row the in-app check runner recorded, not
              a manual verification claim. Check the live site yourself:{' '}
              <a
                href={appConfig.url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {appConfig.url}
              </a>
              .
            </p>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
              No check has been recorded yet, so there is no last-verification
              date to show. The in-app check runner writes a row per check
              once migration 032 is applied — until then this section stays
              empty rather than showing a hardcoded date. Check the live
              site yourself:{' '}
              <a
                href={appConfig.url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {appConfig.url}
              </a>
              .
            </p>
          )}
          <h2 className="mt-10 text-xl font-semibold">Last price refresh</h2>
          {lastRefresh ? (
            <div className="mt-4 rounded-lg border p-6">
              <p className="text-muted-foreground">
                Last refresh run: {formatDateTime(lastRefresh.started_at)} —{' '}
                {REFRESH_RUN_STATUS_LABELS[lastRefresh.status] ?? lastRefresh.status}
                {lastRefresh.source === 'alerts-check'
                  ? ' (started by the alerts check)'
                  : ''}
                .
              </p>
              {(() => {
                const failedSteps = Object.entries(lastRefresh.steps ?? {})
                  .filter(([, step]) => step.status === 'failed')
                  .map(([name]) => name);
                return failedSteps.length > 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Steps that failed in this run: {failedSteps.join(', ')}. A failed
                    step reports its own error in the run record; the other steps
                    still ran.
                  </p>
                ) : null;
              })()}
              {lastRefresh.finished_at ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Finished {formatDateTime(lastRefresh.finished_at)}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
              No price refresh run has been recorded yet. Refresh runs are recorded
              once migration 040 is applied — until then the app has no record of
              the last refresh, and this section stays empty rather than inventing
              one.
            </p>
          )}
          <p className="mt-4 text-sm text-muted-foreground">
            What this page cannot tell you: the app cannot see whether the owner&apos;s
            scheduled jobs are running — the price refresh (every 6 hours) and the uptime
            check runner (every 5 minutes) are cron-job.org jobs that live outside the app —
            or the state of the owner&apos;s external UptimeRobot monitor. Those are stated
            as unknown here, not as up. The last recorded refresh run above is written by
            the refresh endpoint itself once migration 040 is applied — it shows the last
            run that actually happened, not whether the cron job is still scheduled.
            No uptime percentage is shown until the in-app
            check runner has recorded real checks.
          </p>

          <h2 className="mt-10 text-xl font-semibold">Uptime — last 90 days</h2>
          {uptime.hasData && uptime.uptimePercent !== null ? (
            <div className="mt-4 rounded-lg border p-6">
              <p className="text-4xl font-bold">{uptime.uptimePercent}%</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {uptime.okChecks} of {uptime.totalChecks} recorded checks passed
                {uptime.firstCheckAt ? ` since ${formatDate(uptime.firstCheckAt)}` : ''}.
                {uptime.lastCheckAt ? ` Last check: ${formatDate(uptime.lastCheckAt)}.` : ''}
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
              No uptime percentage yet — no checks have been recorded. Uptime will appear here
              once the in-app check runner has accrued checks (see the monitoring setup in the
              project docs). No percentage is shown until real checks exist.
            </p>
          )}

          <h2 className="mt-10 text-xl font-semibold">Incident history</h2>
          {incidents.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed p-6 text-muted-foreground">
              No incidents recorded yet. Incidents are recorded here when the team confirms a
              service problem; an empty list means none have been recorded since monitoring
              started.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {incidents.map((incident) => (
                <li key={incident.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-medium">{incident.title}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {incident.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Started {formatDate(incident.started_at)}
                    {incident.resolved_at ? ` — resolved ${formatDate(incident.resolved_at)}` : ' — still open'}
                  </p>
                  {incident.description ? (
                    <p className="mt-2 text-sm">{incident.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-10 text-xs text-muted-foreground">
            Uptime is computed from recorded in-app checks only. An external monitor
            (UptimeRobot) may be configured separately by the site owner; the app cannot
            see its state, so this page makes no claim about it. See docs/uptime.md.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
