/**
 * Alert expiry + cleanup (Sections 21–25, Stage F: F6).
 *
 * Until now alerts never expired: no `expires_at` in `alerts` /
 * `guest_email_alerts`, no cleanup job — stale alerts accumulated
 * forever and the checker kept evaluating them on every run.
 *
 * Rules (all fail-open while migration 063 is unapplied):
 * - An alert lives DEFAULT_ALERT_EXPIRY_DAYS (90) from creation.
 *   The DB default in migration 063 stamps `expires_at` at insert;
 *   code never writes the column, so alert creation works
 *   identically before and after 063 is applied.
 * - Expiry is fixed at creation: firing an alert does NOT extend
 *   it (extending on trigger would need the checker to write the
 *   column, which would break the trigger update while 063 is
 *   unapplied). A user whose alert expired re-creates it — the
 *   create path dedupes identical active alerts, so re-creation
 *   is cheap and never duplicates.
 * - `cleanupExpiredAlerts` deactivates (never deletes) expired
 *   rows: history and unsubscribe tokens are preserved, the alert
 *   simply stops firing. It runs as a step of the existing refresh
 *   chain (alerts/check + prices/refresh) — no second scheduler.
 * - The checker ALSO skips expired alerts defensively
 *   (`loadExpiredAlertIds`, counted as `skippedExpired`), so an
 *   alert expiring between cleanup runs never fires in between.
 * - A NULL `expires_at` (pre-migration rows, or a row created
 *   before 063 backfilled it) never expires by code — fail-open,
 *   never silently drop an alert the user still wants.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';
import { logger } from '@/lib/config/logger';

/** Default alert lifetime, in days, from creation. */
export const DEFAULT_ALERT_EXPIRY_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The expiry instant for an alert created at `from` (default now):
 * creation + DEFAULT_ALERT_EXPIRY_DAYS. Pure — pins the same 90-day
 * rule the migration-063 DB default expresses in SQL, so the two
 * can never silently drift apart.
 */
export function alertExpiryDate(from: Date = new Date()): string {
  return new Date(from.getTime() + DEFAULT_ALERT_EXPIRY_DAYS * DAY_MS).toISOString();
}

/**
 * True only when `expiresAt` is a parseable date in the past.
 * NULL / undefined / garbage never expires (fail-open: a row
 * without a recorded expiry is an alert the user still wants).
 */
export function isAlertExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return false;
  return at < now.getTime();
}

/** PostgREST / Postgres codes for "column does not exist". */
function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

const EXPIRY_LOOKUP_LIMIT = 1000;

/**
 * Ids of active alerts whose `expires_at` has passed. Best-effort
 * and total: a missing `expires_at` column (migration 063 not
 * applied) or any other read failure yields an empty set — the
 * caller then treats every alert as unexpired, exactly as today.
 */
export async function loadExpiredAlertIds(
  supabase: AnySupabaseClient,
  now: Date = new Date()
): Promise<Set<string>> {
  return (await loadExpiredIds(supabase, 'alerts', now)).ids;
}

/** Same lookup for the guest table (migration 026). */
export async function loadExpiredGuestAlertIds(
  supabase: AnySupabaseClient,
  now: Date = new Date()
): Promise<Set<string>> {
  return (await loadExpiredIds(supabase, 'guest_email_alerts', now)).ids;
}

async function loadExpiredIds(
  supabase: AnySupabaseClient,
  table: 'alerts' | 'guest_email_alerts',
  now: Date
): Promise<{ ids: Set<string>; missingColumn: boolean }> {
  const out = new Set<string>();
  try {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .eq('active', true)
      .lt('expires_at', now.toISOString())
      .limit(EXPIRY_LOOKUP_LIMIT);

    if (error) {
      if (!isMissingColumnError(error)) {
        logger.warn('loadExpiredAlertIds: expiry lookup failed, treating all alerts as unexpired', {
          table,
          error: error.message,
        });
      }
      return { ids: out, missingColumn: isMissingColumnError(error) };
    }

    for (const row of (data ?? []) as Array<{ id: string }>) {
      if (row.id) out.add(row.id);
    }
  } catch (err) {
    // A stub/older client without `.lt`, a network failure, anything:
    // never throw out of an expiry lookup — an empty set is the
    // fail-open answer and the checker run continues.
    logger.warn('loadExpiredAlertIds: expiry lookup failed, treating all alerts as unexpired', {
      table,
      error: String(err),
    });
  }
  return { ids: out, missingColumn: false };
}

export interface AlertExpiryCleanupResult {
  /** Signed-in alerts deactivated this run. */
  alertsDeactivated: number;
  /** Guest alerts deactivated this run. */
  guestAlertsDeactivated: number;
  /**
   * Present only when the `expires_at` column is missing
   * (migration 063 not applied): nothing was deactivated, and
   * this is a clean skip, not a failure — the refresh chain
   * reports it and continues.
   */
  skipped?: string;
}

async function deactivateExpired(
  supabase: AnySupabaseClient,
  table: 'alerts' | 'guest_email_alerts',
  ids: Set<string>
): Promise<{ deactivated: number; missingColumn: boolean }> {
  if (ids.size === 0) return { deactivated: 0, missingColumn: false };
  try {
    const { error } = await supabase
      .from(table)
      .update({ active: false })
      .in('id', [...ids]);
    if (error) {
      logger.warn('cleanupExpiredAlerts: deactivation failed', {
        table,
        count: ids.size,
        error: error.message,
      });
      return { deactivated: 0, missingColumn: isMissingColumnError(error) };
    }
    return { deactivated: ids.size, missingColumn: false };
  } catch (err) {
    logger.warn('cleanupExpiredAlerts: deactivation failed', {
      table,
      count: ids.size,
      error: String(err),
    });
    return { deactivated: 0, missingColumn: false };
  }
}

/**
 * Deactivate every expired alert (signed-in + guest) in one pass.
 * Total: never throws. When migration 063 is unapplied the
 * `expires_at` column does not exist, both lookups yield empty
 * sets, and the result carries `skipped` so the caller can report
 * a clean skip instead of a failure.
 */
export async function cleanupExpiredAlerts(
  supabase: AnySupabaseClient,
  now: Date = new Date()
): Promise<AlertExpiryCleanupResult> {
  // Probe the column once via the alerts lookup: a missing-column
  // error there means 063 is unapplied for both tables (the
  // migration adds both columns), so skip the whole run.
  const alertIds = await loadExpiredIds(supabase, 'alerts', now);
  if (alertIds.missingColumn) {
    return {
      alertsDeactivated: 0,
      guestAlertsDeactivated: 0,
      skipped: 'expires_at column missing (migration 063 not applied)',
    };
  }
  const guestIds = await loadExpiredIds(supabase, 'guest_email_alerts', now);
  if (guestIds.missingColumn) {
    return {
      alertsDeactivated: 0,
      guestAlertsDeactivated: 0,
      skipped: 'expires_at column missing (migration 063 not applied)',
    };
  }

  const alerts = await deactivateExpired(supabase, 'alerts', alertIds.ids);
  const guests = await deactivateExpired(supabase, 'guest_email_alerts', guestIds.ids);

  const result: AlertExpiryCleanupResult = {
    alertsDeactivated: alerts.deactivated,
    guestAlertsDeactivated: guests.deactivated,
  };
  if (alerts.deactivated + guests.deactivated > 0) {
    logger.info('cleanupExpiredAlerts: deactivated expired alerts', { ...result });
  }
  return result;
}
