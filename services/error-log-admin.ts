/**
 * Admin surfacing of the application error log (Section 18, item 45).
 *
 * The `error_log` table (migration 048) stores one row per recorded
 * application error: level, message, route, request id, user, and
 * free-form context. This module is the read side for the owner
 * dashboard at /app/owner/page.tsx: the most recent errors, newest
 * first. There is deliberately NO writer here yet — no caller
 * records errors into the table today (audit §1 #10), so until a
 * writer lands the table stays empty and the page says so.
 *
 * Missing-table guard: migration 048 is unapplied, so the table
 * does not exist yet. A missing-table error (42P01 / PGRST205)
 * returns `{ tableMissing: true }` instead of throwing — the page
 * renders the honest "error_log table not applied yet" empty state.
 * Any other read error is reported, never silently treated as "no
 * errors". The rows are written only through the service-role
 * client (no anon/authenticated write policy on the table), so the
 * page reads through `createSupabaseServiceClient()` as well. The
 * owner layout already redirects non-admins server-side; this
 * module does no auth of its own.
 *
 * Writer (Section 18, Phase 2 follow-up to item 45): `logApiError`
 * (`lib/api/error-logging.ts`) persists every API error here
 * best-effort via `insertErrorLogRow`, and `markProductRefreshFailed`
 * (`services/freshness.ts`) persists per-product refresh failures
 * with their reason the same way. Both writers tolerate the table
 * being missing — until migration 048 is applied the rows are
 * skipped, never thrown.
 */

import type { AnySupabaseClient } from '@/lib/supabase/types';

const ERROR_LOG_TABLE = 'error_log';

/** True when the error means "this table does not exist (yet)". */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205';
}

export interface ErrorLogRow {
  id: string;
  created_at: string;
  level: string;
  message: string;
  request_id: string | null;
  route: string | null;
  user_id: string | null;
  meta: Record<string, unknown> | null;
}

/** One row to insert into `error_log` (migration 048). */
export interface ErrorLogInsert {
  level: string;
  message: string;
  request_id?: string | null;
  route?: string | null;
  user_id?: string | null;
  meta?: Record<string, unknown>;
}

export type InsertErrorLogOutcome = 'inserted' | 'missing-table' | 'failed';

/**
 * Best-effort insert of one error-log row. NEVER throws: a missing
 * table (migration 048 unapplied) returns 'missing-table', any
 * other insert failure returns 'failed' — the caller logs at debug
 * level and moves on. The row is written only through the
 * service-role client (the table has no anon/authenticated INSERT
 * policy); callers pass the client they already hold.
 */
export async function insertErrorLogRow(
  supabase: AnySupabaseClient,
  row: ErrorLogInsert
): Promise<InsertErrorLogOutcome> {
  try {
    const { error } = await supabase.from(ERROR_LOG_TABLE).insert({
      level: row.level,
      message: row.message,
      request_id: row.request_id ?? null,
      route: row.route ?? null,
      user_id: row.user_id ?? null,
      meta: row.meta ?? {},
    });
    if (!error) return 'inserted';
    if (isMissingTableError(error)) return 'missing-table';
    return 'failed';
  } catch {
    return 'failed';
  }
}

export interface ListRecentErrorsResult {
  errors: ErrorLogRow[];
  /** True when the error_log table does not exist yet (migration 048 unapplied). */
  tableMissing: boolean;
  /** Non-missing-table read error message, when the read failed for another reason. */
  error?: string;
}

/**
 * Most recent error-log rows, newest first. Fail-open on a missing
 * table (tableMissing: true, errors: []); any other error is
 * reported in `error` with errors: [] — never invented as an empty
 * history.
 */
export async function listRecentErrors(
  supabase: AnySupabaseClient,
  limit = 20
): Promise<ListRecentErrorsResult> {
  try {
    const { data, error } = await supabase
      .from(ERROR_LOG_TABLE)
      .select('id, created_at, level, message, request_id, route, user_id, meta')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTableError(error)) {
        return { errors: [], tableMissing: true };
      }
      return { errors: [], tableMissing: false, error: error.message ?? 'Error log could not be read.' };
    }
    return { errors: (data ?? []) as unknown as ErrorLogRow[], tableMissing: false };
  } catch (err) {
    return {
      errors: [],
      tableMissing: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One failed product refresh, as recorded in `error_log` (Section 18, item 47). */
export interface RefreshFailureRow {
  id: string;
  created_at: string;
  message: string;
  productId: string;
  productName: string | null;
  productSlug: string | null;
  reason: string | null;
}

export interface ListRefreshFailuresResult {
  failures: RefreshFailureRow[];
  /** True when the error_log table does not exist yet (migration 048 unapplied). */
  tableMissing: boolean;
  /** Non-missing-table read error message, when the read failed for another reason. */
  error?: string;
}

/**
 * Most recent per-product refresh failures, newest first — the
 * failed-products list for /admin/refresh-runs (Section 18,
 * item 47). Reads the rows `markProductRefreshFailed` wrote to
 * `error_log` with `route = 'prices.refresh'` and a `productId`
 * in `meta`; API errors logged under the same route without a
 * product are NOT refresh failures and are filtered out here.
 * Same missing-table contract as listRecentErrors.
 */
export async function listRefreshFailures(
  supabase: AnySupabaseClient,
  limit = 20
): Promise<ListRefreshFailuresResult> {
  try {
    const { data, error } = await supabase
      .from(ERROR_LOG_TABLE)
      .select('id, created_at, message, meta')
      .eq('route', 'prices.refresh')
      .order('created_at', { ascending: false })
      .limit(limit * 2);
    if (error) {
      if (isMissingTableError(error)) {
        return { failures: [], tableMissing: true };
      }
      return { failures: [], tableMissing: false, error: error.message ?? 'Refresh failures could not be read.' };
    }
    const failures: RefreshFailureRow[] = ((data ?? []) as unknown as Array<{
      id: string;
      created_at: string;
      message: string;
      meta: Record<string, unknown> | null;
    }>)
      .filter((row) => typeof row.meta?.productId === 'string')
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        created_at: row.created_at,
        message: row.message,
        productId: row.meta?.productId as string,
        productName: typeof row.meta?.productName === 'string' ? (row.meta.productName as string) : null,
        productSlug: typeof row.meta?.productSlug === 'string' ? (row.meta.productSlug as string) : null,
        reason: typeof row.meta?.reason === 'string' ? (row.meta.reason as string) : null,
      }));
    return { failures, tableMissing: false };
  } catch (err) {
    return {
      failures: [],
      tableMissing: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One AI error group: how many recorded errors share a route / level. */
export interface AiErrorGroup {
  label: string;
  count: number;
}

export interface AiErrorBreakdown {
  /** True when the error_log table does not exist yet (migration 048 unapplied). */
  tableMissing: boolean;
  /** Non-missing-table read error message, when the read failed for another reason. */
  error?: string;
  /** Total AI-related rows found in the scanned window (0 is a real count only when tableMissing is false). */
  total: number;
  /** How many rows were scanned to build the breakdown (the read window). */
  scanned: number;
  /** AI-related errors grouped by route label, most frequent first. */
  byRoute: AiErrorGroup[];
  /** AI-related errors grouped by level, most frequent first. */
  byLevel: AiErrorGroup[];
  /** The most recent AI-related rows (newest first). */
  recent: ErrorLogRow[];
}

/**
 * True when an error_log row belongs to the AI surface: its route
 * label names an AI route/capability, or its meta names an AI
 * provider. Rows from logApiError carry route labels such as
 * 'ai-search'; refresh rows ('prices.refresh') are NOT AI errors
 * and are excluded.
 */
export function isAiErrorRow(row: {
  route?: string | null;
  meta?: Record<string, unknown> | null;
}): boolean {
  const route = (row.route ?? '').toLowerCase();
  if (
    route.includes('ai') ||
    route.includes('predict') ||
    route.includes('forecast') ||
    route.includes('visual-search') ||
    route.includes('visual_search') ||
    route.includes('chat') ||
    route.includes('recommend')
  ) {
    return true;
  }
  const meta = row.meta ?? {};
  return (
    typeof meta.provider === 'string' ||
    typeof meta.providerKey === 'string' ||
    typeof meta.capability === 'string'
  );
}

/**
 * AI error breakdown (Section 19, Phase 7, §12 #73) — errors by
 * route and by level, from `error_log` plus nothing else: the
 * engine's in-memory failure counts live in the usage summary and
 * are composed by the /admin/ai API route, not duplicated here.
 *
 * Honesty contract (same as listRecentErrors): migration 048
 * unapplied → `{ tableMissing: true }` and the control center
 * renders "error logging not yet active" — never an empty chart
 * pretending to be zero errors. Table applied but no AI rows →
 * total 0 IS a real count (the table exists and writers log into
 * it), but the page still says no AI error has been recorded
 * since the table was applied, not "the AI surface is error-free"
 * — most AI routes do not call logApiError yet (audit §1 #28),
 * so an empty log is a missing-writer gap, not proof of health.
 * The read window is the most recent 200 rows; `scanned` says so.
 */
export async function getAiErrorBreakdown(
  supabase: AnySupabaseClient,
  limit = 200
): Promise<AiErrorBreakdown> {
  const empty: AiErrorBreakdown = {
    tableMissing: false,
    total: 0,
    scanned: 0,
    byRoute: [],
    byLevel: [],
    recent: [],
  };
  try {
    const { data, error } = await supabase
      .from(ERROR_LOG_TABLE)
      .select('id, created_at, level, message, request_id, route, user_id, meta')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      if (isMissingTableError(error)) {
        return { ...empty, tableMissing: true };
      }
      return {
        ...empty,
        error: error.message ?? 'AI error breakdown could not be read.',
      };
    }
    const rows = ((data ?? []) as unknown as ErrorLogRow[]).filter(isAiErrorRow);
    const byRouteMap = new Map<string, number>();
    const byLevelMap = new Map<string, number>();
    for (const row of rows) {
      const route = row.route ?? 'unknown route';
      byRouteMap.set(route, (byRouteMap.get(route) ?? 0) + 1);
      byLevelMap.set(row.level, (byLevelMap.get(row.level) ?? 0) + 1);
    }
    const groups = (map: Map<string, number>): AiErrorGroup[] =>
      [...map.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
    return {
      tableMissing: false,
      total: rows.length,
      scanned: (data ?? []).length,
      byRoute: groups(byRouteMap),
      byLevel: groups(byLevelMap),
      recent: rows.slice(0, 20),
    };
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
