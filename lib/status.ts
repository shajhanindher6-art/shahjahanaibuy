/**
 * Status page aggregation (Section 4, item 11). Pure logic: given
 * recorded uptime checks + incidents, decide what the /status page
 * says. No data is invented here — when there are no checks yet the
 * overall status is 'unknown' and the page says monitoring started
 * with no checks recorded yet.
 */

import { summarizeUptime, summarizeUptimeFromCounts, type UptimeCheckRow, type UptimeSummary } from '@/lib/uptime';
import type { AnySupabaseClient } from '@/lib/supabase/types';

export type OverallStatus = 'operational' | 'degraded' | 'outage' | 'unknown';

export interface StatusIncident {
  id: string;
  started_at: string;
  resolved_at: string | null;
  title: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  description: string | null;
}

export interface StatusSummary {
  overall: OverallStatus;
  uptime: UptimeSummary;
  openIncidents: StatusIncident[];
  totalIncidents: number;
  /** When monitoring began (first recorded check), or null if none yet. */
  monitoringStartedAt: string | null;
  hasData: boolean;
  message: string;
}

/**
 * Monitoring began with the first recorded check — there is no
 * hardcoded start date. Section 17, Stage H item 5 removed the old
 * MONITORING_STARTED_FALLBACK ('2026-11-10'): a date the code
 * invented went stale by construction, and with no checks recorded
 * the honest statement is that monitoring has not recorded any
 * check yet, not that it started on a particular day.
 */

export function buildStatusSummary(
  checks: UptimeCheckRow[],
  incidents: StatusIncident[],
  windowDays = 90,
  now = new Date()
): StatusSummary {
  const uptime = summarizeUptime(checks, windowDays, now);
  return buildStatusSummaryFromUptime(uptime, incidents);
}

/**
 * The overall-status + message decision, from an already-computed
 * uptime summary. `buildStatusSummary` is the row-based entry
 * point; the /status page uses this one with the counts-based
 * summary from `fetchStatusUptime` (Section 18, item 29) — the
 * decision is identical either way. `lastOk` is the latest check's
 * ok flag: the newest check overall is always the newest in-window
 * check whenever any in-window check exists, so the row-based
 * `latestCheck?.ok` and the counts-based `uptime.lastOk` agree.
 */
export function buildStatusSummaryFromUptime(
  uptime: UptimeSummary,
  incidents: StatusIncident[]
): StatusSummary {
  const openIncidents = incidents.filter((i) => i.status !== 'resolved');
  const hasData = uptime.hasData;

  let overall: OverallStatus;
  let message: string;

  if (!hasData && openIncidents.length === 0) {
    overall = 'unknown';
    message =
      'No checks recorded yet — uptime will appear here once checks accrue.';
  } else if (openIncidents.some((i) => i.status === 'investigating' || i.status === 'identified')) {
    overall = 'outage';
    message = `${openIncidents.length} open incident${openIncidents.length === 1 ? '' : 's'} — we are investigating.`;
  } else if (openIncidents.length > 0) {
    overall = 'degraded';
    message = `${openIncidents.length} incident${openIncidents.length === 1 ? '' : 's'} being monitored.`;
  } else if (!uptime.lastCheckAt || !uptime.lastOk) {
    // Last recorded check failed but no incident was opened yet.
    overall = 'degraded';
    message = 'The most recent check failed. No incident has been opened yet.';
  } else {
    overall = 'operational';
    message = 'All systems operational.';
  }

  return {
    overall,
    uptime,
    openIncidents,
    totalIncidents: incidents.length,
    monitoringStartedAt: uptime.firstCheckAt ?? null,
    hasData,
    message,
  };
}

/**
 * Section 18, item 29 — DB-side uptime summary for the /status
 * page. Four small queries instead of pulling up to 2,000 rows per
 * visit: total checks in the window, ok checks in the window (both
 * `head: true` counts — zero rows transferred), and the first/last
 * check rows (one row each). Returns null on any read failure —
 * the page then renders the same "no data yet" state as before,
 * never a 500.
 */
export async function fetchStatusUptime(
  supabase: AnySupabaseClient,
  windowDays = 90,
  now = new Date()
): Promise<UptimeSummary | null> {
  const cutoff = new Date(
    now.getTime() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();
  try {
    const [totalRes, okRes, firstRes, lastRes] = await Promise.all([
      supabase
        .from('uptime_checks')
        .select('checked_at', { count: 'exact', head: true })
        .gte('checked_at', cutoff),
      supabase
        .from('uptime_checks')
        .select('checked_at', { count: 'exact', head: true })
        .eq('ok', true)
        .gte('checked_at', cutoff),
      supabase
        .from('uptime_checks')
        .select('checked_at')
        .gte('checked_at', cutoff)
        .order('checked_at', { ascending: true })
        .limit(1),
      supabase
        .from('uptime_checks')
        .select('checked_at, ok, status_code, target_url')
        .gte('checked_at', cutoff)
        .order('checked_at', { ascending: false })
        .limit(1),
    ]);
    if (totalRes.error || okRes.error || firstRes.error || lastRes.error) {
      return null;
    }
    const firstRow = (firstRes.data as Array<{ checked_at: string }> | null)?.[0] ?? null;
    const lastRow =
      (
        lastRes.data as Array<{
          checked_at: string;
          ok: boolean;
          status_code: number | null;
          target_url: string | null;
        }> | null
      )?.[0] ?? null;
    return summarizeUptimeFromCounts({
      totalChecks: totalRes.count ?? 0,
      okChecks: okRes.count ?? 0,
      firstCheckAt: firstRow?.checked_at ?? null,
      lastCheckAt: lastRow?.checked_at ?? null,
      lastOk: lastRow ? lastRow.ok : null,
      lastStatusCode: lastRow?.status_code ?? null,
      lastTargetUrl: lastRow?.target_url ?? null,
      windowDays,
    });
  } catch {
    return null;
  }
}
