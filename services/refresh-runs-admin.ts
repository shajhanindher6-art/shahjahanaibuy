/**
 * Admin surfacing of price refresh runs (Section 17, Stage F, item 27).
 *
 * The refresh chain writes one row per run to `price_refresh_runs`
 * (migration 040) — started/finished, overall status, and a compact
 * per-step summary in the `steps` jsonb column. This module is the
 * read side for the admin page at /admin/refresh-runs: the latest
 * runs, the failed steps inside each run, and the last refresh time.
 *
 * Missing-table guard: migration 040 is unapplied, so the table
 * does not exist yet. A missing-table error (42P01 / PGRST205)
 * returns `{ tableMissing: true }` instead of throwing — the page
 * renders the honest "no run records yet — migration 040 not
 * applied" empty state. Any other read error is reported, never
 * silently treated as "no runs".
 *
 * The rows are written only through the service-role client (no
 * anon/authenticated INSERT/UPDATE/DELETE policy on the table), so
 * the page reads through `createSupabaseServiceClient()` as well.
 * The admin layout already redirects non-admins server-side; this
 * module does no auth of its own.
 */

import type { RefreshRunRow, RefreshStepCounts, RefreshStepSummary } from '@/services/refresh-run';
import type { AnySupabaseClient } from '@/lib/supabase/types';

const RUNS_TABLE = 'price_refresh_runs';

/** True when the error means "this table does not exist (yet)". */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

export interface ListRefreshRunsResult {
  runs: RefreshRunRow[];
  /** True when the price_refresh_runs table does not exist yet (migration 040 unapplied). */
  tableMissing: boolean;
  /** Non-missing-table read error message, when the read failed for another reason. */
  error?: string;
}

/**
 * Latest refresh runs, newest first. Fail-open on a missing table
 * (tableMissing: true, runs: []); any other error is reported in
 * `error` with runs: [] — never invented as an empty history.
 */
export async function listRefreshRuns(
  supabase: AnySupabaseClient,
  limit = 50
): Promise<ListRefreshRunsResult> {
  try {
    const { data, error } = await supabase
      .from(RUNS_TABLE)
      .select('id, source, started_at, finished_at, status, steps, error')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTableError(error)) {
        return { runs: [], tableMissing: true };
      }
      return { runs: [], tableMissing: false, error: error.message ?? 'Refresh runs could not be read.' };
    }
    return { runs: (data ?? []) as unknown as RefreshRunRow[], tableMissing: false };
  } catch (err) {
    return {
      runs: [],
      tableMissing: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One failed step inside a run, with the error the chain recorded. */
export interface FailedRefreshStep {
  name: string;
  error?: string;
  /** Section 18, item 38 — the step's stored counts, when it has them. */
  counts?: RefreshStepCounts;
}

/**
 * The failed steps of one run, in the order the chain recorded
 * them. Steps that are ok / skipped / degraded are not failed
 * steps and are left out — a run with no failed steps returns [].
 */
export function failedStepsOf(run: RefreshRunRow): FailedRefreshStep[] {
  const steps: Record<string, RefreshStepSummary> = (run.steps ?? {}) as Record<
    string,
    RefreshStepSummary
  >;
  return Object.entries(steps)
    .filter(([, summary]) => summary?.status === 'failed')
    .map(([name, summary]) => ({ name, error: summary.error, counts: summary.counts }));
}

/**
 * Human labels for the ten steps of the refresh chain, in chain
 * order (see POST /api/v1/prices/refresh). Unknown step names fall
 * back to the raw name — a new step must never render blank.
 */
export const REFRESH_STEP_LABELS: Record<string, string> = {
  ebay: 'eBay live prices',
  refresh: 'Recorded price refresh',
  alerts: 'Price alerts',
  hunts: 'Deal hunts',
  digest: 'Weekly digest',
  notifications: 'Notification dispatch',
  stock: 'Availability snapshots',
  guestAlerts: 'Guest email alerts',
  guestEmail: 'Guest email queue',
  savedSearches: 'Saved-search matches',
};

export function refreshStepLabel(name: string): string {
  return REFRESH_STEP_LABELS[name] ?? name;
}
