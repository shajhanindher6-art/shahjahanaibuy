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
