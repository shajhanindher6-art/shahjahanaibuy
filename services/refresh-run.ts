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
 *      so a new run may start. The guard FAILS OPEN ONLY for a
 *      missing table (migration 040 not applied): the run proceeds
 *      unguarded and unrecorded, and a warning is logged — never a
 *      500. ANY other guard-read or insert error FAILS SAFE
 *      (Section 18, item 35 — coordinator decision, 12 Nov 2026):
 *      the run is NOT started, and the caller reports the honest
 *      not-started state. Failing open on any error used to let a
 *      transient DB error silently run the refresh unguarded,
 *      risking duplicate concurrent runs writing conflicting price
 *      history; failing closed on a guard error costs at most one
 *      6h refresh cycle (prices just stay stale one more cycle).
 *      Missing-table is the only error that must fail open — the
 *      Section 16/17 precedent (PGRST205 = table not applied).
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
import { logApiError } from '@/lib/api/error-logging';

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
 * Section 21–25, Stage J, J-P2-9 — scrub error text before it is
 * stored in `price_refresh_runs` (publicly readable: the
 * `price_refresh_runs_select_public` policy is TO anon USING true).
 * Step errors used to carry raw `err.message` strings, which can
 * contain Supabase/PostgREST text (table/column names, codes).
 * Only messages from the safe allowlist below are stored verbatim
 * (they are written by this module and carry no infra detail);
 * everything else is replaced by a generic sentence. The full
 * detail is already logged server-side (logger.warn) at the site
 * that produced the error, so nothing diagnostic is lost — it
 * just never lands in a publicly readable column.
 */
const SAFE_REFRESH_RUN_ERRORS = [
  'Failed to load step data',
  'Run never finished',
] as const;

export function scrubRefreshRunError(message: string | null | undefined): string {
  const GENERIC = 'Step failed — details logged server-side.';
  if (!message) return GENERIC;
  if (SAFE_REFRESH_RUN_ERRORS.some((prefix) => message.startsWith(prefix))) return message;
  return GENERIC;
}

/**
 * Run one refresh-chain step in isolation. `isFailed` lets a step
 * report its own load failure without throwing (P1-8): it receives
 * the step's result and returns an error message, or null when the
 * step genuinely succeeded.
 *
 * Sections 21–25 (gate fix) — the error here is RAW on purpose.
 * This outcome feeds the CRON_SECRET-only cron response, where the
 * operator needs the real reason ('checker exploded',
 * 'price_history: ...'). The scrub for the publicly readable
 * `price_refresh_runs` table lives at the storage boundary only
 * (finishRefreshRun scrubs every step error before writing).
 * Scrubbing here used to blank the response too, which broke the
 * P1-1/P1-8 route tests and hid the failing step from the caller.
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
  /** Section 18, item 38 — per-step counts, where honestly computed. */
  counts?: RefreshStepCounts;
  /**
   * Sections 21–25, Stage D (item 5) — how many times the step
   * ran in this run (1 normally, 2 when the chain-level retry
   * re-ran it). Stored so the run record shows a retry happened.
   */
  attempts?: number;
};

export function summarizeStep<T>(
  outcome: RefreshStepOutcome<T>,
  /** Section 18, item 38 — omit when the step computes no counts. */
  counts?: RefreshStepCounts
): RefreshStepSummary {
  // Sections 21–25 (gate fix) — the error is carried RAW here:
  // this summary is returned in the CRON_SECRET-only cron
  // response, and finishRefreshRun scrubs it before writing the
  // publicly readable run row. Scrubbing here blanked the response
  // and broke the S18 "keeps the error and the counts together"
  // test for no security gain — the storage boundary is where
  // the public policy applies.
  const summary: RefreshStepSummary = outcome.error
    ? { status: outcome.status, error: outcome.error }
    : { status: outcome.status };
  if (counts) summary.counts = counts;
  return summary;
}

// ---------------------------------------------------------------------------
// Per-step load-error sanitising (Section 18, Phase 2 — item 11,
// audit §1 #58)
// ---------------------------------------------------------------------------

/**
 * Section 18, item 38 — per-step counts stored in
 * `price_refresh_runs.steps` alongside the status/error. Only
 * counts the step already computes are stored — never invented:
 * a step with no failure count (hunts) stores NO counts at all
 * rather than a fabricated zero.
 */
export interface RefreshStepCounts {
  processed: number;
  succeeded: number;
  failed: number;
  skipped?: number;
  /**
   * Final 100% — F-P2-15: suspicious price changes flagged by
   * this step (spike / fake-sale / inflation). Optional: only
   * steps that assess prices report it. Stored in the run row
   * and rendered on /admin/refresh-runs as the notification that
   * flags await review in the data-quality panel.
   */
  suspiciousPriceChanges?: number;
}

/**
 * Generic per-step load-error text for the refresh response.
 * The response's `loadError` fields used to carry the raw
 * Supabase error (`${table}: ${error.message}`), which can leak a
 * table/column name or a PostgREST code to the CRON_SECRET
 * caller. This helper logs the full detail server-side (logger,
 * masked) and returns ONLY this generic string for the response.
 *
 * WIRING (left for the Section 18 coordinator — the refresh route
 * file is owned by the Wave 2 performance worker): replace the
 * four raw assignments in `app/api/v1/prices/refresh/route.ts`
 * (`recordAvailabilitySnapshots`: lines ~220, ~235, ~257-258,
 * ~322-323) with
 * `result.loadError = result.loadError ?? sanitizeRefreshStepLoadError(table, error)`
 * (or the matching table name for the merchant/history reads).
 * The adjacent `logger.warn` lines at those sites then duplicate
 * this helper's log and can be dropped. `runRefreshStep`'s own
 * `error` field is unaffected — it already stores the raw message
 * in the server-side run record, never in the response.
 */
export const REFRESH_STEP_LOAD_ERROR_MESSAGE = 'Failed to load step data';

export function sanitizeRefreshStepLoadError(table: string, error: unknown): string {
  // PostgREST errors are plain-looking objects ({ code, message })
  // in the response shape, but the real PostgrestError extends
  // Error — extract .message AND .code whenever they exist so
  // the server-side log keeps the real detail (String(error)
  // alone would log '[object Object]').
  let detail: string;
  if (error instanceof Error) detail = error.message;
  else if (error != null && typeof error === 'object' && 'message' in error)
    detail = String((error as { message: unknown }).message);
  else if (error == null) detail = 'no rows returned';
  else detail = String(error);
  const code =
    error != null && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  logger.warn('refresh step load failed', {
    table,
    ...(code ? { code } : {}),
    error: detail,
  });
  return REFRESH_STEP_LOAD_ERROR_MESSAGE;
}

/**
 * Sections 21–25, Stage D (item 5) — chain-level retry for the
 * refresh route. Per-step isolation (runRefreshStep) already
 * keeps one failed step from killing the chain, but a failed
 * wave was never retried AS A CHAIN: a transient DB blip in wave
 * B failed the step for the whole 6h cycle. This helper retries
 * ONLY the steps that failed, ONCE, after a backoff — bounded
 * (max 2 attempts per step per run), recorded (the route stamps
 * `attempts: 2` on retried step summaries), and safe: every
 * refresh step is change-only / idempotent by construction, so a
 * re-run cannot double-record a price, double-queue an alert, or
 * double-send a digest (each has its own dedupe/guard).
 *
 * The caller supplies `rerun(name)`, which re-runs one named
 * step and returns its fresh outcome (or null when the name is
 * unknown — never throws: a rerun that throws is recorded as a
 * still-failed outcome). The helper sleeps ONCE before the retry
 * pass (not between steps — the steps are independent), and
 * returns the fresh outcomes keyed by step name.
 */
export const CHAIN_RETRY_DELAY_MS = 2000;
/** Total attempts per step per run: the first pass + one retry. */
export const CHAIN_RETRY_MAX_ATTEMPTS = 2;

export interface ChainRetryResult {
  /** Steps that were retried (in rerun order). */
  retried: string[];
  /** Steps that recovered on retry (status 'ok' after retry). */
  recovered: string[];
  /** Steps still failed after the retry. */
  stillFailed: string[];
  /** Fresh outcomes for the retried steps, keyed by step name. */
  outcomes: Map<string, RefreshStepOutcome<unknown>>;
}

export async function retryFailedRefreshSteps(
  failedNames: string[],
  rerun: (name: string) => Promise<RefreshStepOutcome<unknown> | null>,
  options?: {
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<ChainRetryResult> {
  const result: ChainRetryResult = {
    retried: [],
    recovered: [],
    stillFailed: [],
    outcomes: new Map(),
  };
  if (failedNames.length === 0) return result;
  const delayMs = options?.delayMs ?? CHAIN_RETRY_DELAY_MS;
  const sleepFn =
    options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  await sleepFn(delayMs);
  for (const name of failedNames) {
    result.retried.push(name);
    try {
      const outcome = await rerun(name);
      if (!outcome) {
        result.stillFailed.push(name);
        continue;
      }
      result.outcomes.set(name, outcome);
      if (outcome.status === 'ok') result.recovered.push(name);
      else result.stillFailed.push(name);
    } catch (err) {
      logger.warn('chain retry: rerun failed', { step: name, error: String(err) });
      result.stillFailed.push(name);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Runs table + "run in progress" guard (P1-5, P1-7)
// ---------------------------------------------------------------------------

export type RefreshRunSource = 'prices-refresh' | 'alerts-check';

export type RefreshRunStatus =
  | 'running'
  | 'completed'
  | 'completed_with_failures'
  | 'failed'
  /**
   * FINAL 100% (F-P1-28, K10b) — the run finished without a
   * single failed step, but NO live price was fetched by any
   * live-fetch leg (eBay updated/inserted 0, pipeline refreshed
   * 0). A job must never be called successful when no provider
   * data was retrieved — but it is not a failure either (no
   * provider configured is an honest skip, not a crash). This
   * distinct status is the honest middle: "completed, nothing
   * fetched". Migration 040's CHECK must admit it (see the
   * migration file) — the run row cannot be stored otherwise.
   */
  | 'completed_no_live_source';

/**
 * FINAL 100% (F-P1-28, K10b) — the single overall-status rule
 * for a refresh run, shared by POST /api/v1/prices/refresh (and
 * any future trigger with live-fetch legs). Pure, so the route
 * tests pin it without a DB.
 *
 *   failed steps = all steps            → 'failed'
 *   some steps failed                   → 'completed_with_failures'
 *   no failures, zero live prices       → 'completed_no_live_source'
 *   no failures, ≥1 live price fetched  → 'completed'
 *
 * `livePricesFetched` counts LIVE prices only: eBay listings
 * upserted from a real Browse response + pipeline products with
 * a fresh provider point recorded. DB re-reads (refresh step
 * inserts) are NOT live fetches and never count here — a run
 * that only re-recorded stored prices is
 * 'completed_no_live_source'.
 */
export function resolveRefreshRunStatus(args: {
  failedSteps: number;
  totalSteps: number;
  livePricesFetched: number;
}): Exclude<RefreshRunStatus, 'running'> {
  if (args.failedSteps > 0) {
    return args.failedSteps >= args.totalSteps && args.totalSteps > 0
      ? 'failed'
      : 'completed_with_failures';
  }
  return args.livePricesFetched > 0 ? 'completed' : 'completed_no_live_source';
}

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

/**
 * Section 18, item 35 — the same check for a THROWN error (a
 * transport failure throws an Error instead of returning
 * `{ error }`). Only a missing-table throw fails open; any other
 * throw fails safe. The message match is deliberately narrow:
 * PostgREST missing-table errors carry PGRST205 / 42P01 (or the
 * Postgres "relation … does not exist" text).
 */
function isMissingTableThrown(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string }).code;
  if (code === '42P01' || code === 'PGRST205') return true;
  return (
    message.includes('PGRST205') ||
    message.includes('42P01') ||
    /relation .* does not exist/i.test(message)
  );
}

export interface StartRefreshRunResult {
  /** False when another run is in progress OR the guard failed (see reason). */
  started: boolean;
  /** The new run's id, or null when the table does not exist yet. */
  runId: string | null;
  /** Present only when started is false. */
  reason?: 'run-in-progress' | 'guard-error';
  /** The in-progress run's id, when started is false. */
  existingRunId?: string;
  /** The guard error message, when reason is 'guard-error'. */
  error?: string;
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
        return { started: true, runId: null };
      }
      // Section 18, item 35 — any OTHER guard-read error fails
      // SAFE: the run is not started. Running unguarded on a
      // transient DB error risked duplicate concurrent runs.
      logger.warn('tryStartRefreshRun: guard read failed — run NOT started', {
        error: error.message,
      });
      // Section 20, §12 #53 — a guard read failure is a server error.
      logApiError(new Error(`refresh guard read failed: ${error.message}`), {
        route: 'refresh-run-guard',
        status: 500,
        context: { phase: 'guard-read' },
      });
      return { started: false, runId: null, reason: 'guard-error', error: error.message };
    }
    running = (data ?? []) as Array<{ id: string; started_at: string }>;
  } catch (err) {
    if (isMissingTableThrown(err)) {
      logger.warn('tryStartRefreshRun: price_refresh_runs missing (migration 040 not applied) — running unguarded');
      return { started: true, runId: null };
    }
    logger.warn('tryStartRefreshRun: guard read threw — run NOT started', {
      error: String(err),
    });
    // Section 20, §12 #53 — a guard read failure is a server error.
    logApiError(err, {
      route: 'refresh-run-guard',
      status: 500,
      context: { phase: 'guard-read' },
    });
    return {
      started: false,
      runId: null,
      reason: 'guard-error',
      error: err instanceof Error ? err.message : String(err),
    };
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
        return { started: true, runId: null };
      }
      // Section 18, item 35 — a failed run insert fails SAFE too:
      // without a recorded `running` row there is no guard, so the
      // run must not start unguarded.
      logger.warn('tryStartRefreshRun: run insert failed — run NOT started', {
        error: error?.message,
      });
      // Section 20, §12 #53 — a guard insert failure is a server error.
      logApiError(new Error(`refresh run insert failed: ${error?.message ?? 'run insert failed'}`), {
        route: 'refresh-run-guard',
        status: 500,
        context: { phase: 'guard-insert' },
      });
      return {
        started: false,
        runId: null,
        reason: 'guard-error',
        error: error?.message ?? 'run insert failed',
      };
    }
    return { started: true, runId: (data as { id: string }).id };
  } catch (err) {
    if (isMissingTableThrown(err)) {
      logger.warn('tryStartRefreshRun: price_refresh_runs missing (migration 040 not applied) — running unguarded');
      return { started: true, runId: null };
    }
    logger.warn('tryStartRefreshRun: run insert threw — run NOT started', {
      error: String(err),
    });
    // Section 20, §12 #53 — a guard insert failure is a server error.
    logApiError(err, {
      route: 'refresh-run-guard',
      status: 500,
      context: { phase: 'guard-insert' },
    });
    return {
      started: false,
      runId: null,
      reason: 'guard-error',
      error: err instanceof Error ? err.message : String(err),
    };
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
    // Section 21–25, Stage J, J-P2-9 — `steps` and `error` are
    // publicly readable (TO anon policy); never store raw infra
    // text. The scrub lives HERE, at the storage boundary only:
    // the cron response carries the same summaries raw (see
    // runRefreshStep / summarizeStep), so the operator still sees
    // the real reason while the public row never does.
    const storedSteps: Record<string, RefreshStepSummary> = {};
    for (const [name, summary] of Object.entries(steps)) {
      storedSteps[name] = summary.error
        ? { ...summary, error: scrubRefreshRunError(summary.error) }
        : summary;
    }
    const { error: updateError } = await supabase
      .from(RUNS_TABLE)
      .update({
        status,
        finished_at: new Date().toISOString(),
        steps: storedSteps,
        // Section 21–25, Stage J, J-P2-9 — `error` is publicly
        // readable (TO anon policy); never store raw infra text.
        error: error ? scrubRefreshRunError(error) : null,
      })
      .eq('id', runId);
    if (updateError) {
      logger.warn('finishRefreshRun: run update failed', {
        runId,
        error: updateError.message,
      });
    }
    // Final 100%, F-P1-54 — the dateless-verified stale flip runs
    // at the end of every recorded run, next to the dated flip in
    // the refresh chain: a 'verified' stamp with no check date
    // must not live forever. Best-effort and never throwing (the
    // flip itself is fail-safe); a flip failure is logged inside
    // the flip and never fails the run record. When 040 is
    // unapplied there is no runId and this is a no-op — the
    // dateless flip then needs the one-line call next to the dated
    // flip in services/price-refresh.ts (W1 merge point).
    try {
      const { flipDatelessVerifiedToStale } = await import(
        './verification-stale-flip'
      );
      const flipped = await flipDatelessVerifiedToStale(supabase);
      if (flipped.flippedProducts + flipped.flippedMerchantRows > 0) {
        logger.warn('finishRefreshRun: dateless verified rows flipped to stale', {
          runId,
          flippedProducts: flipped.flippedProducts,
          flippedMerchantRows: flipped.flippedMerchantRows,
        });
      }
    } catch {
      // Staleness bookkeeping must never fail a refresh run.
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

/**
 * Final 100%, F-P1-53 — recent recorded refresh runs, newest
 * first, for the dead-man's switch. Public-safe by design: the
 * rows are already publicly readable (TO anon policy — the same
 * read /status makes via `getLatestRefreshRun`), so this asserts
 * no admin role and takes no admin user id. Fail-open on a
 * missing table (`tableMissing: true`, runs: []); any other read
 * error is reported in `error` with runs: [] — never invented
 * as an empty history.
 */
export interface GetRecentRefreshRunsResult {
  runs: RefreshRunRow[];
  /** True when the price_refresh_runs table does not exist yet (migration 040 unapplied). */
  tableMissing: boolean;
  error?: string;
}

export async function getRecentRefreshRuns(
  supabase: AnySupabaseClient,
  limit = 5
): Promise<GetRecentRefreshRunsResult> {
  const safeLimit = Math.min(Math.max(1, limit), 20);
  try {
    const { data, error } = await supabase
      .from(RUNS_TABLE)
      .select('id, source, started_at, finished_at, status, steps, error')
      .order('started_at', { ascending: false })
      .limit(safeLimit);
    if (error) {
      if (isMissingTableError(error)) {
        return { runs: [], tableMissing: true };
      }
      return {
        runs: [],
        tableMissing: false,
        error: error.message ?? 'Refresh runs could not be read.',
      };
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
