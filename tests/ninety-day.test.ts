/**
 * Tests for the 90-day lowest derivation (Option 18).
 * Pure function — no DB, no network.
 */
import { describe, it, expect } from 'vitest';
import { deriveLowest90d } from '@/services/ninety-day';
import type { FakeSalePoint } from '@/services/fake-sale';

function point(price: number, iso: string): FakeSalePoint {
  return { price, recordedAt: iso };
}

// 100 days of history: one point every 10 days, lowest $900 on day 20.
const FULL_100_DAYS: FakeSalePoint[] = [
  point(1000, '2026-08-01T00:00:00Z'),
  point(980, '2026-08-11T00:00:00Z'),
  point(900, '2026-08-21T00:00:00Z'),
  point(950, '2026-08-31T00:00:00Z'),
  point(990, '2026-09-10T00:00:00Z'),
  point(1010, '2026-09-20T00:00:00Z'),
  point(1000, '2026-09-30T00:00:00Z'),
  point(1020, '2026-10-10T00:00:00Z'),
  point(990, '2026-10-20T00:00:00Z'),
  point(999, '2026-10-30T00:00:00Z'),
  point(999, '2026-11-09T00:00:00Z'),
];

describe('deriveLowest90d', () => {
  it('returns the lowest inside the 90-day window when history covers 90 days', () => {
    const r = deriveLowest90d(FULL_100_DAYS);
    expect(r.status).toBe('ready');
    // Window anchored at Nov 9: Aug 11 onward. $900 (Aug 21) is inside.
    expect(r.lowest).toBe(900);
    expect(r.pointsInWindow).toBe(10);
    expect(r.spanDays).toBe(100);
    expect(r.reason).toBeNull();
  });

  it('ignores a lower price recorded before the 90-day window', () => {
    const pts = [
      point(500, '2026-07-01T00:00:00Z'), // 131 days before latest — outside
      ...FULL_100_DAYS,
    ];
    const r = deriveLowest90d(pts);
    expect(r.status).toBe('ready');
    expect(r.lowest).toBe(900);
  });

  it('is pending when recorded history spans less than 90 days (today: ~7 days)', () => {
    const pts = [
      point(1018.98, '2026-10-26T00:00:00Z'),
      point(999, '2026-11-02T00:00:00Z'),
    ];
    const r = deriveLowest90d(pts);
    expect(r.status).toBe('pending');
    expect(r.lowest).toBeNull();
    expect(r.spanDays).toBe(7);
    expect(r.reason).toMatch(/History data pending/);
  });

  it('is pending with a single recorded point', () => {
    const r = deriveLowest90d([point(999, '2026-11-02T00:00:00Z')]);
    expect(r.status).toBe('pending');
    expect(r.lowest).toBeNull();
    expect(r.pointsInWindow).toBe(1);
  });

  it('is pending with no recorded prices at all', () => {
    const r = deriveLowest90d([]);
    expect(r.status).toBe('pending');
    expect(r.lowest).toBeNull();
    expect(r.reason).toMatch(/No recorded prices/);
  });

  it('drops invalid prices and dates instead of treating them as zero', () => {
    const pts = [
      point(0, '2026-08-01T00:00:00Z'),
      point(-5, '2026-08-11T00:00:00Z'),
      { price: 900, recordedAt: 'not-a-date' },
      ...FULL_100_DAYS,
    ];
    const r = deriveLowest90d(pts);
    expect(r.status).toBe('ready');
    expect(r.lowest).toBe(900);
  });

  it('is pending when the span is exactly 89 days', () => {
    const pts = [
      point(1000, '2026-08-12T00:00:00Z'),
      point(999, '2026-11-09T00:00:00Z'),
    ];
    const r = deriveLowest90d(pts);
    expect(r.status).toBe('pending');
    expect(r.spanDays).toBe(89);
  });

  it('is ready when the span is exactly 90 days', () => {
    const pts = [
      point(1000, '2026-08-11T00:00:00Z'),
      point(999, '2026-11-09T00:00:00Z'),
    ];
    const r = deriveLowest90d(pts);
    expect(r.status).toBe('ready');
    expect(r.lowest).toBe(999);
    expect(r.spanDays).toBe(90);
  });
});
