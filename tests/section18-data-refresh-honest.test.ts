/**
 * Section 18, Phase 2 — data/refresh honest 202 (audit §1 #29,
 * §12 item 41).
 *
 * POST /api/v1/data/refresh used to return 202 "queued" while the
 * SynchronousQueue ran the job inline — the admin request blocked
 * until the whole fetch finished, then got a status that said the
 * work had not started. Now the route reads the recorded job
 * result (getJobResult) and returns the real outcome (200
 * 'completed' / 'failed' with processed + errors). The 202
 * 'queued' response survives only where the work genuinely has
 * not run yet (BullMQ / delayed job).
 *
 * With no provider configured, processProductFetch returns
 * { success: false, processed: 0, errors: ['No available provider
 * for product.fetch'] } without touching the DB. In the test env
 * the Mock provider IS registered (it is only unregistered in
 * production) and getForRetailer falls back to the preferred
 * provider, so the route-level no-provider path is unreachable
 * here — the route test asserts the 'completed' inline outcome,
 * and the failure path of getJobResult is covered at the queue
 * level below (a job type with no processor).
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/middleware', () => ({
  logApiRequest: vi.fn(),
  rateLimitResponse: vi.fn(async () => null),
  getClientIp: vi.fn(() => '203.0.113.95'),
  requireAdmin: vi.fn(async () => ({ userId: 'admin-1' })),
}));

import { POST } from '@/app/api/v1/data/refresh/route';

describe('data/refresh honest outcome (item 41)', () => {
  it('returns the real inline outcome (200 completed), not "queued"', async () => {
    const req = new NextRequest('http://localhost/api/v1/data/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'test product' }),
    });
    const res = await POST(req);
    // Not 202: the job already ran inline on the synchronous queue.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { jobId: string; status: string; processed: number; errors: string[] };
    };
    expect(body.data.jobId).toMatch(/^sync-/);
    expect(body.data.status).toBe('completed');
    expect(body.data.processed).toBe(0);
    expect(body.data.errors).toEqual([]);
  });

  it('still validates the body before enqueueing', async () => {
    const req = new NextRequest('http://localhost/api/v1/data/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('getJobResult failure path (item 41)', () => {
  it('records the real failure for a job with no processor', async () => {
    const { enqueueJob, getJobResult } = await import('@/lib/workers/queue');
    const jobId = await enqueueJob({
      type: 'no-such-job-type' as never,
      data: {},
    });
    const outcome = getJobResult(jobId);
    expect(outcome).toEqual({
      success: false,
      processed: 0,
      errors: ['No processor registered for type: no-such-job-type'],
    });
  });

  it('returns undefined for an unknown job id', async () => {
    const { getJobResult } = await import('@/lib/workers/queue');
    expect(getJobResult('sync-never-enqueued')).toBeUndefined();
  });
});
