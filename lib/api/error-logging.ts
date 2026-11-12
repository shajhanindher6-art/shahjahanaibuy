/**
 * Shared API error logging + Sentry capture (Section 18, Phase 0 —
 * audit §1 #4, §12 items 44 + 9).
 *
 * The audit found 137/181 API routes with catch blocks that log
 * nothing and ZERO `captureException` calls in any API route. This
 * module is the ONE helper every route adopts, catch block by catch
 * block — do not build a second one.
 *
 * Contract (item 9): every call records the HTTP status, the
 * request duration, and the request id. The detail is logged
 * server-side ONLY — response shapes are unchanged (the generic
 * error envelope in `lib/api/responses` still returns the same
 * public message; never put the error detail or a stack trace in
 * a response body).
 *
 * Sentry (item 44): `captureException` fires ONLY when a DSN is
 * configured (`SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`). Sentry is
 * dormant/unproven live, so the guard is load-bearing: with no DSN
 * this helper is a structured log line and nothing else, and it
 * never throws — a failure inside the Sentry call is swallowed so
 * error reporting can never break the error response itself.
 *
 * Secrets: the log record goes through `logger.error`, which
 * masks the keys in `lib/config/logger.ts` (SENSITIVE_KEYS). Never
 * pass a secret, token, password, or credential value in `context`
 * or inside the error message — pass an id / code instead.
 *
 * Persistent store (Section 18, Phase 2 follow-up to item 45):
 * after logging + Sentry capture, `logApiError` also persists the
 * error to the `error_log` table (migration 048) best-effort via
 * `writeErrorLog` — fire-and-forget, never blocking the response,
 * never throwing. Until migration 048 is applied the table does
 * not exist and the write is skipped silently (missing-table
 * 42P01/PGRST205 → debug log, not an error). Rows are visible on
 * /owner (via `listRecentErrors`) and the refresh-failure rows on
 * /admin/refresh-runs (via `listRefreshFailures`).
 */

import * as Sentry from '@sentry/nextjs';
import type { NextRequest } from 'next/server';
import { logger } from '@/lib/config/logger';
import { getRequestId } from './request-id';
import { insertErrorLogRow } from '@/services/error-log-admin';

export interface ApiErrorLogOptions {
  /**
   * The route's request. Supplies method, path, and the request id
   * (read off the `x-request-id` header set by `middleware.ts`).
   * Optional so service-level helpers without a request object
   * (e.g. the prices/refresh step helpers) can still log with a
   * `route` label — pass `route` in that case.
   */
  request?: Pick<NextRequest, 'method' | 'headers'> & {
    nextUrl?: { pathname: string };
  };
  /** Stable route label, e.g. 'subscriptions' or 'prices.refresh'. */
  route?: string;
  /** HTTP status of the response returned for this error (default 500). */
  status?: number;
  /** `Date.now()` captured at handler start — duration is derived from it. */
  startedAt?: number;
  /** Explicit duration in ms; wins over `startedAt` when both are given. */
  durationMs?: number;
  /** The signed-in user's id, when the caller knows it (stored as error_log.user_id). */
  userId?: string;
  /** Extra structured fields (masked by the logger — never secrets). */
  context?: Record<string, unknown>;
}

/** True when a Sentry DSN is present, i.e. capture is possible. */
export function isSentryConfigured(): boolean {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

export interface ErrorLogWrite {
  level: 'error' | 'critical';
  message: string;
  requestId?: string;
  route?: string;
  userId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Persist one error row to `error_log` (migration 048) through the
 * service-role client. Best-effort: never throws, never blocks —
 * when the service-role key is unconfigured there is no client and
 * the write is skipped; when the table is missing (048 unapplied)
 * the row is skipped with a debug log, not an error; any other
 * insert failure is a debug log too. The service client is loaded
 * by dynamic import so this module stays importable from edge
 * routes (the service client itself is Node-only).
 */
export async function writeErrorLog(write: ErrorLogWrite): Promise<void> {
  try {
    const { createSupabaseServiceClient } = await import('@/lib/supabase/service');
    const service = createSupabaseServiceClient();
    if (!service) {
      logger.debug('error_log writer skipped: service-role key not configured');
      return;
    }
    const outcome = await insertErrorLogRow(service, {
      level: write.level,
      message: write.message,
      request_id: write.requestId ?? null,
      route: write.route ?? null,
      user_id: write.userId ?? null,
      meta: write.meta ?? {},
    });
    if (outcome === 'missing-table') {
      logger.debug('error_log writer skipped: table missing (migration 048 not applied)');
    } else if (outcome === 'failed') {
      logger.debug('error_log writer failed: row not stored (best-effort, skipped)');
    }
  } catch {
    // The writer must never break the error response.
    logger.debug('error_log writer failed: row not stored (best-effort, skipped)');
  }
}

/**
 * Log an API error structurally and, when Sentry is configured,
 * capture it there too. Returns the request id so the caller can
 * correlate the log line / Sentry event with the response (the
 * same id travels back as the `x-request-id` response header).
 * Never throws.
 */
export function logApiError(error: unknown, options: ApiErrorLogOptions = {}): string {
  const requestId = options.request
    ? getRequestId(options.request)
    : crypto.randomUUID();
  const durationMs =
    options.durationMs ??
    (options.startedAt !== undefined ? Date.now() - options.startedAt : undefined);
  const status = options.status ?? 500;
  const route = options.route ?? options.request?.nextUrl?.pathname ?? 'unknown';
  const message = error instanceof Error ? error.message : String(error);

  try {
    logger.error('API error', {
      requestId,
      route,
      ...(options.request?.nextUrl?.pathname
        ? { path: options.request.nextUrl.pathname }
        : {}),
      ...(options.request ? { method: options.request.method } : {}),
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
      error: message,
      ...(options.context ?? {}),
    });
  } catch {
    // Logging must never break the error response.
  }

  if (isSentryConfigured()) {
    try {
      Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        {
          tags: { route, status: String(status) },
          extra: {
            requestId,
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(options.context ?? {}),
          },
        }
      );
    } catch {
      // Sentry must never break the error response either.
    }
  }

  // Persist to error_log best-effort, fire-and-forget: the insert
  // never blocks the response and never throws (see writeErrorLog).
  void writeErrorLog({
    level: 'error',
    message,
    requestId,
    route,
    userId: options.userId,
    meta: {
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(options.context ?? {}),
    },
  });

  return requestId;
}
