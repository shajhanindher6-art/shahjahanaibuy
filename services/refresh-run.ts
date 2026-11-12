/**
 * Refresh-run bookkeeping (Section 15, P1-1 / P1-5 / P1-7).
 *
 * Three pieces, shared by POST /api/v1/prices/refresh and POST
 * /api/v1/alerts/check (the same chain, two triggers):
 *
 *   1. runRefreshStep() — per-step isolation. Every step runs in
 *      its own try/catch; a throw (or a result that reports its own
 *      load failure) is recorded as `status: 'failed'` with the
 *      error message, the step's zeroed fallback counts are kept,
 *      and the chain CONTINUES with the next step. A failed step is
 *      never reported as a silent success.
 *   2. tryStartRefreshRun() / finishRefreshRun() — the "run in
 *      progress" guard + the per-run record (migration 040,
 *      price_refresh_runs). Before a run starts, a still-`running`
 *      row younger than REFRESH_RUN_STALE_MS blocks a second
 *      overlapping run (cron + /alerts/check + the Supabase Edge
 *      Function worker can otherwise duplicate the chain). A
 *      `running` row older than the window is stale — a previous
 *      run that crashed before finishing — and is marked `failed`
 *      so a new run may start. The guard FAILS OPEN: when the
 *      table does not exist yet (migration 040 not applied) the
 *      run proceeds unguarded and unrecorded, and a warning is
 *      logged — never a 500.
 *   3. getLatestRefreshRun() — the status page's read of the
 *      latest run. Also fail-open: a missing table or any read
 *      error returns null and the page keeps its existing text.
 *
 * Why a table guard and not pg_advisory_lock: the Supabase client
 * talks to Postgres through a connection pooler, so a
 * session-scoped advisory lock is not reliably held across the
 * queries of one run. The runs-table check is the guard that
 * actually survives the pooler. The remaining race (two triggers
 * in the same instant, both seeing "no running row") is bounded
 * by the single-scheduler rule — one cron job, one trigger — and
 * the worst case is a duplicate run, not corrupt data: every step
 * is change-only / idempotent by construction.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

// ---------------------------------------------------------------------------
// Per-step isolation (P1-1)
// ---------------------------------------------------------------------------

export type RefreshStepStatus = 'ok' | 'failed' | 'skipped';

export interface RefreshStepOutcome<T> {
  status: RefreshStepStatus;
  result: T;
  /** Present only when status is 'failed'. */
  error?: string;
}

/**
 * Run one refresh-chain step in isolation. `isFailed` lets a step
 * report its own load failure without throwing (P1-8): it receives
 * the step's result and returns an error message, or null when the
 * step genuinely succeeded.
 */
export async function runRefreshStep<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
  isFailed?: (result: T) => string | null
): Promise<RefreshStepOutcome<T>> {
  try {
    const result = await fn();
    const failedReason = isFailed?.(result) ?? null;
    if (failedReason) {
      logger.warn(`refresh step failed: ${label}`, { error: failedReason });
      return { status: 'failed', result, error: failedReason };
    }
    return { status: 'ok', result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`refresh step failed: ${label}`, { error: message });
    return { status: 'failed', result: fallback, error: message };
  }
}

/** Compact per-step summary stored in price_refresh_runs.steps. */
export type RefreshStepSummary = {
  status: RefreshStepStatus;
  error?: string;
};

export function summarizeStep<T>(
  outcome: RefreshStepOutcome<T>
): RefreshStepSummary {
  return outcome.error
    ? { status: outcome.status, error: outcome.error }
    : { status: outcome.status };
}

// ---------------------------------------------------------------------------
// Runs table + "run in progress" guard (P1-5, P1-7)
// ---------------------------------------------------------------------------

export type RefreshRunSource = 'prices-refresh' | 'alerts-check';

export type RefreshRunStatus =
  | 'running'
  | 'completed'
  | 'completed_with_failures'
  | 'failed';

/**
 * A `running` row older than this is a crashed run, not a live one.
 * A refresh run takes seconds to a few minutes; 30 minutes is far
 * beyond any healthy run, and short enough that a crashed run never
 * blocks the next 6-hour cadence.
 */
export const REFRESH_RUN_STALE_MS = 30 * 60 * 1000;

export interface RefreshRunRow {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  steps: Record<string, RefreshStepSummary>;
  error: string | null;
}

const RUNS_TABLE = 'price_refresh_runs';

/** True when the error means "this table does not exist (yet)". */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

export interface StartRefreshRunResult {
  /** False only when another run is currently in progress. */
  started: boolean;
  /** The new run's id, or null when the table does not exist yet. */
  runId: string | null;
  /** Present only when started is false. */
  reason?: 'run-in-progress';
  /** The in-progress run's id, when started is false. */
  existingRunId?: string;
}

export async function tryStartRefreshRun(
  supabase: AnySupabaseClient,
  source: RefreshRunSource
): Promise<StartRefreshRunResult> {
  let running: Array<{ id: string; started_at: string }> = [];
  try {
    const { data, error } = await supabase
      .from(RUNS_TABLE)
      .select('id, started_at')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) {
      if (isMissingTableError(error)) {
        logger.warn('tryStartRefreshRun: price_refresh_runs missing (migration 040 not applied) — running unguarded');
      } else {
        logger.warn('tryStartRefreshRun: guard read failed — running unguarded', {
          error: error.message,
        });
      }
      return { started: true, runId: null };
    }
    running = (data ?? []) as Array<{ id: string; started_at: string }>;
  } catch (err) {
    logger.warn('tryStartRefreshRun: guard read threw — running unguarded', {
      error: String(err),
    });
    return { started: true, runId: null };
  }

  const current = running[0];
  if (current) {
    const ageMs = Date.now() - new Date(current.started_at).getTime();
    if (ageMs < REFRESH_RUN_STALE_MS) {
      return {
        started: false,
        runId: null,
        reason: 'run-in-progress',
        existingRunId: current.id,
      };
    }
    // Stale: a previous run crashed before finishing. Mark it so
    // the status page never shows a forever-"running" row, then
    // start the new run. Best effort — a failure here must not
    // block the new run.
    try {
      await supabase
        .from(RUNS_TABLE)
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: 'Run never finished — superseded by a newer run after the stale-run window.',
        })
        .eq('id', current.id);
    } catch (err) {
      logger.warn('tryStartRefreshRun: stale-run cleanup failed', {
        error: String(err),
      });
    }
  }

  try {
    const { data, error } = await supabase
      .from(RUNS_TABLE)
      .insert({ source, status: 'running' })
      .select('id')
      .single();
    if (error || !data) {
      if (error && isMissingTableError(error)) {
        logger.warn('tryStartRefreshRun: price_refresh_runs missing (migration 040 not applied) — running unguarded');
      } else {
        logger.warn('tryStartRefreshRun: run insert failed — running unguarded', {
          error: error?.message,
        });
      }
      return { started: true, runId: null };
    }
    return { started: true, runId: (data as { id: string }).id };
  } catch (err) {
    logger.warn('tryStartRefreshRun: run insert threw — running unguarded', {
      error: String(err),
    });
    return { started: true, runId: null };
  }
}

export async function finishRefreshRun(
  supabase: AnySupabaseClient,
  runId: string | null,
  steps: Record<string, RefreshStepSummary>,
  status: Exclude<RefreshRunStatus, 'running'>,
  error?: string
): Promise<void> {
  if (!runId) return;
  try {
    const { error: updateError } = await supabase
      .from(RUNS_TABLE)
      .update({
        status,
        finished_at: new Date().toISOString(),
        steps,
        error: error ?? null,
      })
      .eq('id', runId);
    if (updateError) {
      logger.warn('finishRefreshRun: run update failed', {
        runId,
        error: updateError.message,
      });
    }
  } catch (err) {
    logger.warn('finishRefreshRun: run update threw', {
      runId,
      error: String(err),
    });
  }
}

/**
 * Latest recorded refresh run, for the public /status page.
 * Fail-open: null when the table does not exist yet or the read
 * fails — the page keeps its existing "no refresh recorded yet"
 * text instead of erroring.
 */
export async function getLatestRefreshRun(
  supabase: AnySupabaseClient
): Promise<RefreshRunRow | null> {
  try {
    const { data, error } = await supabase
      .from(RUNS_TABLE)
      .select('id, source, started_at, finished_at, status, steps, error')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0] as unknown as RefreshRunRow;
  } catch {
    return null;
  }
}
