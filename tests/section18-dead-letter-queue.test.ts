/**
 * Section 18, Phase 2 — DLQ surfacing (audit §1 #71, §12 item 42).
 *
 * getDeadLetterQueue() / getQueueMetrics() had no callers, so a
 * job that exhausted its retries surfaced nowhere. The
 * /admin/refresh-runs page now lists the in-memory DLQ (with an
 * honest empty state) plus a queue-metrics summary line. The dead
 * code was NOT deleted — surfacing is the smaller change.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getQueue, getDeadLetterQueue, getQueueMetrics } from '@/lib/workers/queue';

function repoFile(...parts: string[]): string {
  return fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', ...parts),
    'utf8'
  );
}

describe('dead-letter queue surfacing (item 42)', () => {
  it('a failed job lands in the DLQ that the admin page reads', async () => {
    const before = getDeadLetterQueue().length;
    const jobId = await getQueue().enqueue({
      type: 'dlq-test-no-processor' as never,
      data: { probe: true },
    });
    const entries = getDeadLetterQueue();
    expect(entries.length).toBeGreaterThan(before);
    const entry = entries.find((e) => e.id === jobId);
    expect(entry).toBeDefined();
    expect(entry?.type).toBe('dlq-test-no-processor');
    expect(entry?.attempts).toBe(1);
    expect(entry?.error).toContain('No processor registered');
    expect(entry?.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(getQueueMetrics().deadLetterCount).toBe(entries.length);
  });

  it('the admin page renders the DLQ section with an honest empty state', () => {
    const src = repoFile('app', 'admin', 'refresh-runs', 'page.tsx');
    expect(src).toContain('getDeadLetterQueue()');
    expect(src).toContain('getQueueMetrics()');
    expect(src).toContain('Dead-lettered jobs');
    expect(src).toContain('No dead-lettered jobs on this instance.');
    // Per-instance caveat: the numbers say nothing about other instances.
    expect(src).toContain('this instance');
  });
});
