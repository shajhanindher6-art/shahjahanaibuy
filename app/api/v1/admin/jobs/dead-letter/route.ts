/**
 * API v1 admin dead-letter queue endpoint (Sections 21–25, Stage D, item 2).
 * GET /api/v1/admin/jobs/dead-letter — admin only (requireAdmin), read-only.
 *
 * Lists failed jobs from BOTH halves of the DLQ:
 *   - `instance`: the in-memory DLQ on THIS instance
 *     (`lib/workers/queue.ts`, max 1,000, lost on redeploy/restart)
 *     — the live view, with per-job type / attempts / error /
 *     failedAt, plus the raw job data for inspection.
 *   - `persisted`: the `error_log` trail (`route = 'queue.dlq'`,
 *     migration 048) — the half that survives a restart. Until
 *     048 is applied the table does not exist and the response
 *     reports `tableMissing: true` instead of an empty list
 *     pretending no job ever failed.
 *
 * Query params:
 *   - `?id=<jobId>` — inspect one job (in-memory first, then the
 *     persisted trail by `meta.jobId`); 404 when neither half has it.
 *   - `?limit=<n>` — max rows per half (default 50, clamped 1..200).
 *
 * The DLQ is intentionally NOT durable across instances: jobs
 * are recorded in-memory per instance + best-effort into
 * error_log. A truly durable cross-instance queue needs a queue
 * table (owner-gated migration) — the response says so in
 * `durability`, so the admin never mistakes this list for a
 * complete cross-instance record.
 */

import type { NextRequest } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiSuccess, internalError, notFound } from '@/lib/api/responses';
import {
  logApiRequest,
  requireAdmin,
  rateLimitResponse,
  getClientIp,
} from '@/lib/api/middleware';
import { logApiError } from '@/lib/api/error-logging';
import {
  getDeadLetterQueue,
  getQueueMetrics,
} from '@/lib/workers/queue';
import { listDeadLetterFailures, type ListDeadLetterFailuresResult } from '@/services/error-log-admin';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const DURABILITY_NOTE =
  'The dead-letter queue is in-memory per instance (max 1,000 entries, lost on redeploy/restart) plus a best-effort error_log trail (migration 048). It is not a durable cross-instance queue: entries on other instances, and entries lost before 048 was applied, are not listed here.';

export async function GET(request: NextRequest) {
  logApiRequest(request, { endpoint: 'admin.jobs.dead-letter' });
  const limited = await rateLimitResponse(
    `admin.jobs.dead-letter:${getClientIp(request)}`,
    60
  );
  if (limited) return limited;

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const id = params.get('id') ?? undefined;
  const rawLimit = Number.parseInt(params.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    const service = createSupabaseServiceClient();
    const persisted: ListDeadLetterFailuresResult = service
      ? await listDeadLetterFailures(service, limit)
      : { failures: [], tableMissing: true };

    // Newest first in both halves.
    const instance = [...getDeadLetterQueue()]
      .sort((a, b) => b.failedAt.localeCompare(a.failedAt))
      .slice(0, limit);

    if (id) {
      const inMemory = instance.find((entry) => entry.id === id);
      if (inMemory) {
        return apiSuccess({
          entry: { ...inMemory, source: 'instance' as const },
          durability: DURABILITY_NOTE,
        });
      }
      const stored = persisted.failures.find((row) => row.jobId === id);
      if (stored) {
        return apiSuccess({
          entry: { ...stored, source: 'persisted' as const },
          durability: DURABILITY_NOTE,
        });
      }
      return notFound('No dead-lettered job with that id on this instance or in the persisted trail');
    }

    return apiSuccess({
      instance: {
        entries: instance,
        count: instance.length,
        totalOnInstance: getQueueMetrics().deadLetterCount,
        note: 'In-memory entries on THIS instance only — lost on redeploy/restart, and other instances are not shown.',
      },
      persisted: {
        entries: persisted.failures,
        count: persisted.failures.length,
        tableMissing: persisted.tableMissing,
        ...(persisted.error ? { error: persisted.error } : {}),
        note: persisted.tableMissing
          ? 'error_log is not applied yet (migration 048) — no persisted dead-letter trail exists.'
          : 'Persisted trail from error_log (route queue.dlq) — survives restarts, but only for jobs dead-lettered after migration 048 was applied.',
      },
      durability: DURABILITY_NOTE,
    });
  } catch (err) {
    logApiError(err, { request, route: 'admin.jobs.dead-letter', status: 500 });
    return internalError('Failed to fetch dead-letter queue');
  }
}
