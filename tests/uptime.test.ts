import { describe, expect, it, vi } from 'vitest';
import {
  computeUptimePercent,
  runUptimeCheck,
  summarizeUptime,
  type UptimeCheckRow,
} from '@/lib/uptime';
import { buildStatusSummary } from '@/lib/status';
import {
  createOptimisticState,
  optimisticAlertToggle,
  optimisticListAdd,
  optimisticListRemove,
  optimisticWishlistToggle,
} from '@/lib/optimistic';

function check(partial: Partial<UptimeCheckRow> & { ok: boolean }): UptimeCheckRow {
  return {
    checked_at: '2026-11-10T08:00:00.000Z',
    target_url: 'https://shahjahanaibuy-b1zp.vercel.app/',
    status_code: 200,
    response_ms: 120,
    error: null,
    source: 'in-app',
    ...partial,
  };
}

describe('computeUptimePercent', () => {
  it('returns null with zero checks — never an invented 100%', () => {
    expect(computeUptimePercent([])).toBeNull();
  });

  it('computes one-decimal uptime from recorded checks', () => {
    expect(computeUptimePercent([check({ ok: true }), check({ ok: true }), check({ ok: false })])).toBe(66.7);
    expect(computeUptimePercent([check({ ok: true }), check({ ok: true })])).toBe(100);
  });
});

describe('summarizeUptime', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');

  it('reports hasData false and null percent before any checks', () => {
    const summary = summarizeUptime([], 90, now);
    expect(summary.hasData).toBe(false);
    expect(summary.uptimePercent).toBeNull();
    expect(summary.totalChecks).toBe(0);
    expect(summary.firstCheckAt).toBeNull();
  });

  it('ignores checks older than the window', () => {
    const summary = summarizeUptime(
      [
        check({ ok: false, checked_at: '2026-07-01T08:00:00.000Z' }), // > 90 days old
        check({ ok: true, checked_at: '2026-11-10T08:00:00.000Z' }),
      ],
      90,
      now
    );
    expect(summary.totalChecks).toBe(1);
    expect(summary.uptimePercent).toBe(100);
    expect(summary.firstCheckAt).toBe('2026-11-10T08:00:00.000Z');
  });
});

describe('runUptimeCheck', () => {
  it('marks 2xx as up with status and timing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await runUptimeCheck('https://example.com/', fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
    expect(result.responseMs).not.toBeNull();
  });

  it('marks 500 as down and records the HTTP status as the error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await runUptimeCheck('https://example.com/', fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe('HTTP 500');
  });

  it('never throws on a network failure — it records it', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const result = await runUptimeCheck('https://example.com/', fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBeNull();
    expect(result.error).toBe('fetch failed');
  });
});

describe('buildStatusSummary', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');

  it('is unknown with no checks and no incidents', () => {
    const summary = buildStatusSummary([], [], 90, now);
    expect(summary.overall).toBe('unknown');
    expect(summary.hasData).toBe(false);
    expect(summary.uptime.uptimePercent).toBeNull();
    expect(summary.message).toContain('No checks recorded yet');
  });

  it('is operational when the latest check passed and nothing is open', () => {
    const summary = buildStatusSummary([check({ ok: true })], [], 90, now);
    expect(summary.overall).toBe('operational');
    expect(summary.uptime.uptimePercent).toBe(100);
  });

  it('is outage while an incident is under investigation', () => {
    const summary = buildStatusSummary(
      [check({ ok: false })],
      [
        {
          id: '1',
          started_at: '2026-11-10T09:00:00.000Z',
          resolved_at: null,
          title: 'Homepage errors',
          status: 'investigating',
          description: null,
        },
      ],
      90,
      now
    );
    expect(summary.overall).toBe('outage');
    expect(summary.openIncidents).toHaveLength(1);
  });

  it('is degraded when the last check failed but no incident is open', () => {
    const summary = buildStatusSummary([check({ ok: true }), check({ ok: false })], [], 90, now);
    expect(summary.overall).toBe('degraded');
  });

  it('uses the newest check even when rows arrive newest-first', () => {
    // API/page queries order checks DESC; the oldest (failed) row must
    // not override the newest (passed) one.
    const summary = buildStatusSummary(
      [
        check({ ok: true, checked_at: '2026-11-10T10:00:00.000Z' }),
        check({ ok: false, checked_at: '2026-11-10T08:00:00.000Z' }),
      ],
      [],
      90,
      now
    );
    expect(summary.overall).toBe('operational');
  });
});

describe('optimistic helpers', () => {
  it('wishlist toggle adds then removes, and revert restores', () => {
    const first = optimisticWishlistToggle([], 'p1');
    expect(first.next).toEqual(['p1']);
    expect(first.added).toBe(true);
    expect(first.revert()).toEqual([]);

    const second = optimisticWishlistToggle(['p1', 'p2'], 'p1');
    expect(second.next).toEqual(['p2']);
    expect(second.added).toBe(false);
    expect(second.revert()).toEqual(['p1', 'p2']);
  });

  it('alert toggle behaves the same way', () => {
    const result = optimisticAlertToggle(['a1'], 'a2');
    expect(result.next).toEqual(['a1', 'a2']);
    expect(result.added).toBe(true);
  });

  it('list add is a no-op for duplicates and remove reports what left', () => {
    const added = optimisticListAdd(['x'], 'x');
    expect(added.added).toBe(false);
    expect(added.next).toEqual(['x']);

    const removed = optimisticListRemove(['x', 'y', 'z'], (i) => i === 'y');
    expect(removed.next).toEqual(['x', 'z']);
    expect(removed.removed).toEqual(['y']);
    expect(removed.revert()).toEqual(['x', 'y', 'z']);
  });

  it('createOptimisticState commits confirmed state and rolls back on failure', () => {
    const state = createOptimisticState({ saved: false }, { saved: true });
    expect(state.value).toEqual({ saved: true });
    expect(state.commit({ saved: true })).toEqual({ saved: true });
    expect(state.rollback()).toEqual({ saved: false });
  });
});
