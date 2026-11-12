/**
 * Status page aggregation (Section 4, item 11). Pure logic: given
 * recorded uptime checks + incidents, decide what the /status page
 * says. No data is invented here — when there are no checks yet the
 * overall status is 'unknown' and the page says monitoring started
 * with no checks recorded yet.
 */

import { summarizeUptime, type UptimeCheckRow, type UptimeSummary } from '@/lib/uptime';

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
  const openIncidents = incidents.filter((i) => i.status !== 'resolved');
  const hasData = uptime.hasData;

  // Latest recorded check, regardless of the order the caller passed
  // rows in (API/page queries return newest-first; tests may not).
  const sorted = [...checks].sort(
    (a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime()
  );
  const latestCheck = sorted[sorted.length - 1] ?? null;

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
  } else if (!uptime.lastCheckAt || !latestCheck?.ok) {
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
