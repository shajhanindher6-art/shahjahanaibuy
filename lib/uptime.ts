/**
 * Uptime monitoring (Section 4, item 13) — in-app check runner + the
 * pure math the status page (Section 4, item 11) renders.
 *
 * Honesty rule: uptime % is computed from RECORDED checks only.
 * Before any check has been recorded there is no percentage — the
 * status page says "monitoring started <date>, no checks recorded
 * yet". A single failed check is never auto-promoted to an incident;
 * incidents are human-recorded (see docs/uptime.md).
 */

export interface UptimeCheckRow {
  checked_at: string;
  target_url: string;
  status_code: number | null;
  ok: boolean;
  response_ms: number | null;
  error: string | null;
  source: string;
}

export interface UptimeSummary {
  /** Total recorded checks inside the window. */
  totalChecks: number;
  okChecks: number;
  /** Null when totalChecks is 0 — no data, not 0% and not 100%. */
  uptimePercent: number | null;
  windowDays: number;
  firstCheckAt: string | null;
  lastCheckAt: string | null;
  hasData: boolean;
  /**
   * Whether the latest check inside the window was ok (null when
   * there is none). Section 18, item 29: the counts-based summary
   * needs this without the row — it is the "most recent check
   * failed" signal the status page's degraded branch reads.
   */
  lastOk?: boolean | null;
  /**
   * The latest check's HTTP status and target URL, for the
   * /status page's "Last verified" line. Optional — only the
   * counts-based summary carries them (the row-based summary
   * reads them from the last row directly).
   */
  lastStatusCode?: number | null;
  lastTargetUrl?: string | null;
}

/** Default target: the live site. Override per call when checking more. */
export const DEFAULT_UPTIME_TARGET = 'https://shahjahanaibuy-b1zp.vercel.app/';

/** One-decimal percentage, or null when there is nothing to divide. */
export function computeUptimePercent(checks: Pick<UptimeCheckRow, 'ok'>[]): number | null {
  if (checks.length === 0) return null;
  const ok = checks.filter((c) => c.ok).length;
  return Math.round((ok / checks.length) * 1000) / 10;
}

/**
 * Summarize recorded checks over the last `windowDays` days.
 * Checks older than the window are ignored; when none remain,
 * uptimePercent is null and hasData is false.
 */
export function summarizeUptime(
  checks: UptimeCheckRow[],
  windowDays = 90,
  now = new Date()
): UptimeSummary {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  const inWindow = checks
    .filter((c) => new Date(c.checked_at).getTime() >= cutoff)
    .sort((a, b) => new Date(a.checked_at).getTime() - new Date(b.checked_at).getTime());

  return {
    totalChecks: inWindow.length,
    okChecks: inWindow.filter((c) => c.ok).length,
    uptimePercent: computeUptimePercent(inWindow),
    windowDays,
    firstCheckAt: inWindow[0]?.checked_at ?? null,
    lastCheckAt: inWindow[inWindow.length - 1]?.checked_at ?? null,
    hasData: inWindow.length > 0,
    lastOk: inWindow.length > 0 ? inWindow[inWindow.length - 1].ok : null,
    lastStatusCode: inWindow[inWindow.length - 1]?.status_code ?? null,
    lastTargetUrl: inWindow[inWindow.length - 1]?.target_url ?? null,
  };
}

/**
 * Section 18, item 29 — the same summary, from DB-side counts
 * instead of rows. The /status page used to pull up to 2,000
 * `uptime_checks` rows per visit and aggregate in JS; the page now
 * asks Postgres for two counts (total + ok inside the window) and
 * the first/last check rows, and this builds the identical summary
 * from those numbers. `lastOk` is the ok flag of the latest check
 * inside the window — the same check `summarizeUptime` would have
 * read as the latest row (the newest check overall is always
 * inside the window whenever any in-window check exists).
 */
export function summarizeUptimeFromCounts(input: {
  totalChecks: number;
  okChecks: number;
  firstCheckAt: string | null;
  lastCheckAt: string | null;
  lastOk: boolean | null;
  windowDays: number;
  lastStatusCode?: number | null;
  lastTargetUrl?: string | null;
}): UptimeSummary {
  const { totalChecks, okChecks } = input;
  return {
    totalChecks,
    okChecks,
    uptimePercent:
      totalChecks === 0
        ? null
        : Math.round((okChecks / totalChecks) * 1000) / 10,
    windowDays: input.windowDays,
    firstCheckAt: input.firstCheckAt,
    lastCheckAt: input.lastCheckAt,
    hasData: totalChecks > 0,
    lastOk: input.lastOk,
    lastStatusCode: input.lastStatusCode ?? null,
    lastTargetUrl: input.lastTargetUrl ?? null,
  };
}

export interface UptimeCheckResult {
  ok: boolean;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
}

/**
 * Run one HTTP check against a target URL.
 *
 * `fetchImpl` is injectable so tests can run without the network; the
 * default is the global fetch. A 2xx/3xx response counts as up; a
 * timeout, network error, or 4xx/5xx counts as down with the error
 * recorded (never thrown — the recorder must store the failure, not
 * crash on it).
 */
export async function runUptimeCheck(
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000
): Promise<UptimeCheckResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseMs = Date.now() - startedAt;
    const ok = response.status >= 200 && response.status < 400;
    return {
      ok,
      statusCode: response.status,
      responseMs,
      error: ok ? null : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      responseMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
