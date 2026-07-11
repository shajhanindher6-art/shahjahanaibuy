/**
 * API v1 data refresh endpoint.
 * POST /api/v1/data/refresh — trigger a product data fetch job.
 *
 * Enqueues a `product.fetch` job to the worker queue. When Redis/BullMQ is
 * available, the job runs asynchronously. Otherwise, it runs synchronously.
 */

import type { NextRequest } from 'next/server';
import { apiSuccess, badRequest, internalError } from '@/lib/api/responses';
import { logApiRequest, requireAuth } from '@/lib/api/middleware';
import { enqueueJob } from '@/lib/workers/queue';
import type { ProductFetchJobData } from '@/lib/workers/types';
import { z } from 'zod';

const refreshSchema = z.object({
  query: z.string().min(1),
  retailerSlug: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  logApiRequest(request, { endpoint: 'data.refresh' });

  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

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

    return apiSuccess({ jobId, status: 'queued' }, 202);
  } catch {
    return internalError('Failed to enqueue data refresh job');
  }
}
