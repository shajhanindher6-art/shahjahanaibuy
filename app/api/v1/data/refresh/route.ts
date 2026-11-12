/**
 * API v1 data refresh endpoint.
 * POST /api/v1/data/refresh — trigger a product data fetch job.
 *
 * Enqueues a `product.fetch` job to the worker queue. When Redis/BullMQ is
 * available, the job runs asynchronously and the response is honestly
 * 202 'queued'. Otherwise it runs synchronously — and Section 18,
 * item 41 changed the response to match: instead of the old 202
 * "queued" for work that had already finished inline, the route now
 * returns the job's real outcome (200 'completed' / 'failed' with
 * the processed count and errors, read from getJobResult). The 202
 * 'queued' response is kept ONLY for the paths where the work
 * genuinely has not run yet (BullMQ, or a delayed job). No real
 * async queue was introduced.
 *
 * ADMIN-ONLY (security fix 2026-11-05): this route used to accept any
 * signed-in user, and with no real provider configured the job ran the
 * MockProvider inline and inserted fake products into the live catalog.
 * It is now requireAdmin + rate-limited, and the MockProvider is no
 * longer registered in production (see services/providers/registry.ts).
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { getClientIp, logApiRequest, rateLimitResponse, requireAdmin } from '@/lib/api/middleware';
import { enqueueJob, getJobResult } from '@/lib/workers/queue';
import type { ProductFetchJobData } from '@/lib/workers/types';
import { z } from 'zod';

/**
 * Section 18, item 36 — `maxDuration` (see
 * app/api/v1/notifications/process/route.ts for the plan
 * constraint): Vercel Hobby caps serverless execution at 60s —
 * DO NOT raise without a paid plan. The job runs synchronously
 * when Redis is not configured, so the inline fetch must finish
 * inside this cap (item 41 returns the real outcome).
 */
export const maxDuration = 60;

const refreshSchema = z.object({
  query: z.string().min(1),
  retailerSlug: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'data.refresh' });

  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const limited = await rateLimitResponse(getClientIp(request), 10);
  if (limited) return limited;

  try {
    const body = await request.json();
    const parsed = refreshSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest('Invalid request body', {
        errors: parsed.error.issues.map((i) => i.message),
      });
    }

    const jobData: ProductFetchJobData = {
      query: parsed.data.query,
      retailerSlug: parsed.data.retailerSlug,
      limit: parsed.data.limit,
    };

    const jobId = await enqueueJob({
      type: 'product.fetch',
      data: jobData,
      priority: 'normal',
      attempts: 3,
      backoffMs: 5000,
    });

    // Section 18, item 41 — the job ran inline on the synchronous
    // queue, so report its real outcome instead of "queued". When
    // no result is recorded (BullMQ / delayed job) the work has
    // genuinely not run yet, and 202 'queued' stays honest.
    const outcome = getJobResult(jobId);
    if (outcome) {
      return apiSuccess({
        jobId,
        status: outcome.success ? 'completed' : 'failed',
        processed: outcome.processed,
        errors: outcome.errors ?? [],
      });
    }
    return apiSuccess({ jobId, status: 'queued' }, 202);
  } catch {
    return internalError('Failed to enqueue data refresh job');
  }
}
