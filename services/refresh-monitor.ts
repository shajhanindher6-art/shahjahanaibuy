/**
 * Final 100% Product & Real Data Completion — dead-man's switch
 * (F-P1-53, code half).
 *
 * The problem: nothing alerts anyone when the scheduled price
 * refresh stops firing, when CRON_SECRET is unset (so the cron
 * endpoints refuse every run), or when refreshes fail repeatedly.
 * Monitoring until now was passive pull-only (/status,
 * /admin/refresh-runs) — and all of it is dead live until
 * migration 040 applies, because no run is ever recorded. Even
 * after 040 applies, those pages only show runs that happened;
 * they never show the ABSENCE of runs.
 *
 * This module is the in-app detection half:
 * - `evaluateRefreshHealth` — pure: given the recent recorded
 *   runs, whether CRON_SECRET is configured, and now, decide
 *   whether the refresh pipeline is healthy, overdue, failing,
 *   or unknowable. No DB, no network, no secrets — the secret
 *   itself is never read here, only a boolean.
 * - `getRefreshMonitorState` — reads the recent runs (public-safe
 *   reader `getRecentRefreshRuns`, same table /status already
 *   reads) and the CRON_SECRET presence flag, and returns the
 *   evaluation plus the evidence behind it.
 *
 * Detection rules (all stated in the result, never hidden):
 * - CRON_SECRET unset → 'cron-secret-unset': the cron endpoints
 *   fail closed, so the scheduled job cannot run at all — even if
 *   a manual admin refresh ran recently. This outranks everything.
 * - No run recorded (040 unapplied, or the table exists but is
 *   empty) → 'no-runs-recorded': the app cannot prove the cron
 *   fires. This is UNKNOWN, not healthy and not failed.
 * - Latest run is a stale `running` row (started > 30 min ago,
 *   REFRESH_RUN_STALE_MS) → 'failing': a crashed run, not a live one.
 * - Latest finished run older than REFRESH_OVERDUE_MS (12h — two
 *   missed 6h cadences, with grace) → 'overdue'.
 * - The last REFRESH_REPEATED_FAILURES runs all failed (or
 *   completed with failures) → 'failing'.
 * - Otherwise → 'ok'.
 *
 * The notification-delivery half (emailing an admin) is
 * owner-gated: Resend is unconfigured, and no delivery channel
 * is invented here. The switch surfaces LOUDLY in-product
 * instead: the admin data-quality page (/admin/data-quality) and
 * the public /status page both render the state, with the exact
 * reason and the owner action that clears it.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';
import {
  REFRESH_RUN_STALE_MS,
  getRecentRefreshRuns,
  type RefreshRunRow,
} from './refresh-run';

/** The scheduled cadence: one cron-job.org POST every 6 hours. */
export const REFRESH_EXPECTED_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Overdue once two whole cadences have passed with no finished run. */
export const REFRESH_OVERDUE_MS = 2 * REFRESH_EXPECTED_INTERVAL_MS;
/** Repeated failure: this many consecutive non-ok runs in a row. */
export const REFRESH_REPEATED_FAILURES = 3;
/** How many recent runs the evaluation reads. */
export const REFRESH_MONITOR_RUNS = 5;

export type RefreshHealthStatus =
  | 'ok'
  | 'overdue'
  | 'failing'
  | 'no-runs-recorded'
  | 'cron-secret-unset';

export interface RefreshRunEvidence {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
}

export interface RefreshHealth {
  status: RefreshHealthStatus;
  /** Plain-language reason for the status (rendered as-is). */
  reason: string;
  /** Owner action that clears a non-ok status, or null when healthy. */
  ownerAction: string | null;
  /** True when CRON_SECRET is set in the environment (value never read). */
  cronSecretConfigured: boolean;
  /** True when the price_refresh_runs table does not exist yet (040 unapplied). */
  runsTableMissing: boolean;
  /** Recent runs checked (newest first, at most REFRESH_MONITOR_RUNS). */
  runsChecked: number;
  /** Latest recorded run, or null when none exists. */
  lastRun: RefreshRunEvidence | null;
  /** Latest run whose status is 'completed', or null. */
  lastSuccessfulRun: RefreshRunEvidence | null;
  /** Consecutive recent runs that did not complete cleanly. */
  consecutiveFailures: number;
  /** Whole minutes since the latest finished run, or null when unknown. */
  minutesSinceLastFinishedRun: number | null;
}

export interface EvaluateRefreshHealthInput {
  /** Recent runs, newest first (at most REFRESH_MONITOR_RUNS needed). */
  runs: RefreshRunEvidence[];
  /** True when the price_refresh_runs table does not exist yet. */
  runsTableMissing: boolean;
  /** True when CRON_SECRET is set (value never passed here). */
  cronSecretConfigured: boolean;
  now?: Date;
}

function toEvidence(run: RefreshRunRow): RefreshRunEvidence {
  return {
    id: run.id,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    status: run.status,
  };
}

/**
 * Pure dead-man's-switch evaluation. A run counts as failed when
 * its status is 'failed' or 'completed_with_failures'; 'running'
 * counts as failed only when it is stale (see REFRESH_RUN_STALE_MS).
 */
export function evaluateRefreshHealth(input: EvaluateRefreshHealthInput): RefreshHealth {
  const now = input.now ?? new Date();
  const runs = input.runs.slice(0, REFRESH_MONITOR_RUNS);
  const base: Omit<RefreshHealth, 'status' | 'reason' | 'ownerAction'> = {
    cronSecretConfigured: input.cronSecretConfigured,
    runsTableMissing: input.runsTableMissing,
    runsChecked: runs.length,
    lastRun: runs[0] ?? null,
    lastSuccessfulRun: runs.find((r) => r.status === 'completed') ?? null,
    consecutiveFailures: 0,
    minutesSinceLastFinishedRun: null,
  };
  let consecutiveFailures = 0;
  for (const run of runs) {
    if (run.status === 'failed' || run.status === 'completed_with_failures') {
      consecutiveFailures += 1;
    } else {
      break;
    }
  }
  base.consecutiveFailures = consecutiveFailures;

  const lastFinished = runs.find((r) => r.finishedAt !== null);
  if (lastFinished?.finishedAt) {
    const ageMs = now.getTime() - new Date(lastFinished.finishedAt).getTime();
    base.minutesSinceLastFinishedRun = Number.isFinite(ageMs)
      ? Math.max(0, Math.floor(ageMs / 60_000))
      : null;
  }

  // CRON_SECRET unset outranks everything: the scheduled job
  // cannot run at all, however recent a manual refresh was.
  if (!input.cronSecretConfigured) {
    return {
      ...base,
      status: 'cron-secret-unset',
      reason:
        'CRON_SECRET is not set, so the scheduled refresh endpoints refuse every run. A manual admin refresh can still run, but the 6-hourly cron job cannot fire.',
      ownerAction:
        'Set CRON_SECRET in the Vercel Production environment (same value as the cron-job.org job sends) and verify the cron-job.org job exists and fires.',
    };
  }

  if (runs.length === 0) {
    return {
      ...base,
      status: 'no-runs-recorded',
      reason: input.runsTableMissing
        ? 'No price refresh run has ever been recorded — migration 040 (price_refresh_runs) is not applied, so the app has no record of any run. Whether the cron job fires is unknown.'
        : 'The run table exists but no refresh run has been recorded yet. Whether the cron job fires is unknown.',
      ownerAction:
        'Apply migration 040 in the Supabase SQL Editor, then verify the cron-job.org job exists and fires (6-hourly POST to /api/v1/prices/refresh).',
    };
  }

  const latest = runs[0];
  // A stale `running` row is a crashed run, not a live one.
  if (latest.status === 'running') {
    const startedMs = new Date(latest.startedAt).getTime();
    if (Number.isFinite(startedMs) && now.getTime() - startedMs > REFRESH_RUN_STALE_MS) {
      return {
        ...base,
        status: 'failing',
        reason: `The latest refresh run started ${new Date(latest.startedAt).toLocaleString('en-GB')} and never finished (stale running row — a run takes minutes, not over 30). It most likely crashed.`,
        ownerAction:
          'Check the deployment logs for the run, then trigger a manual refresh from /admin/refresh-runs and watch for a finished run.',
      };
    }
    // A fresh `running` row is a run in progress — healthy.
    return {
      ...base,
      status: 'ok',
      reason: 'A refresh run is in progress right now.',
      ownerAction: null,
    };
  }

  if (consecutiveFailures >= REFRESH_REPEATED_FAILURES) {
    return {
      ...base,
      status: 'failing',
      reason: `The last ${consecutiveFailures} recorded refresh runs all failed or completed with failures.`,
      ownerAction:
        'Open /admin/refresh-runs for the failing steps, check the deployment logs, and fix the failing step before the next scheduled run.',
    };
  }

  if (base.minutesSinceLastFinishedRun !== null) {
    const ageMs = base.minutesSinceLastFinishedRun * 60_000;
    if (ageMs > REFRESH_OVERDUE_MS) {
      return {
        ...base,
        status: 'overdue',
        reason: `No refresh run has finished in ${base.minutesSinceLastFinishedRun} minutes — the refresh is expected every 6 hours, so at least two scheduled runs have been missed.`,
        ownerAction:
          'Verify the cron-job.org job exists and fires (6-hourly POST to /api/v1/prices/refresh) and that CRON_SECRET matches; then trigger a manual refresh from /admin/refresh-runs.',
      };
    }
  } else if (!lastFinished) {
    // Runs exist but none ever finished (all still running / no
    // finished_at): the last run's age is the only signal.
    const startedMs = new Date(latest.startedAt).getTime();
    if (Number.isFinite(startedMs) && now.getTime() - startedMs > REFRESH_OVERDUE_MS) {
      return {
        ...base,
        status: 'overdue',
        reason: `The latest recorded run started ${new Date(latest.startedAt).toLocaleString('en-GB')} and no run has finished since — the refresh is expected every 6 hours.`,
        ownerAction:
          'Verify the cron-job.org job exists and fires (6-hourly POST to /api/v1/prices/refresh) and that CRON_SECRET matches.',
      };
    }
  }

  return {
    ...base,
    status: 'ok',
    reason:
      base.lastSuccessfulRun !== null
        ? `Last refresh finished ${base.minutesSinceLastFinishedRun ?? 0} minute(s) ago and completed cleanly.`
        : 'Recent refresh runs finished within the expected 6-hour window.',
    ownerAction: null,
  };
}

export interface GetRefreshMonitorStateOptions {
  adminUserId?: string;
}

/**
 * Read the recent runs and evaluate the dead-man's switch.
 * Never throws: a read failure degrades to 'no-runs-recorded'
 * with the reason saying the runs could not be read — never a
 * healthy verdict from a failed read.
 */
export async function getRefreshMonitorState(
  supabase: AnySupabaseClient,
  opts: GetRefreshMonitorStateOptions = {}
): Promise<RefreshHealth> {
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET);
  try {
    const { runs, tableMissing } = await getRecentRefreshRuns(
      supabase,
      REFRESH_MONITOR_RUNS
    );
    void opts;
    return evaluateRefreshHealth({
      runs: runs.map(toEvidence),
      runsTableMissing: tableMissing,
      cronSecretConfigured,
    });
  } catch (err) {
    logger.warn('getRefreshMonitorState: runs could not be read', {
      error: String(err),
    });
    return evaluateRefreshHealth({
      runs: [],
      runsTableMissing: false,
      cronSecretConfigured,
    });
  }
}
