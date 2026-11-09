/**
 * Tests for Fake Deal 90 (Option 18) — the existing fake-sale
 * detector with a 90-day window. Same thresholds as the 30-day
 * detector (rise >= 10% + drop + sale price not below pre-rise);
 * only the window changes.
 */
import { describe, it, expect } from 'vitest';
import { detectFakeSale, type FakeSalePoint } from '@/services/fake-sale';

function point(price: number, iso: string): FakeSalePoint {
  return { price, recordedAt: iso };
}

describe('detectFakeSale with a 90-day window', () => {
  it('alerts when the rise + drop pattern happens inside 90 days', () => {
    const pts = [
      point(1000, '2026-08-15T00:00:00Z'),
      point(1150, '2026-09-01T00:00:00Z'), // +15% rise
      point(1099, '2026-09-20T00:00:00Z'), // drop, still above pre-rise
    ];
    const r = detectFakeSale(pts, 90);
    expect(r.alert).toBe(true);
    expect(r.windowDays).toBe(90);
    expect(r.risePct).toBeCloseTo(0.15, 3);
    expect(r.explanation).toMatch(/raised just before this sale/);
  });

  it('does NOT alert when the rise started more than 90 days before the sale', () => {
    const pts = [
      point(1000, '2026-06-01T00:00:00Z'), // pre-rise low, outside window
      point(1150, '2026-06-20T00:00:00Z'), // peak, outside window
      point(1099, '2026-09-20T00:00:00Z'), // latest — window starts ~Jun 22
    ];
    const r = detectFakeSale(pts, 90);
    expect(r.alert).toBe(false);
  });

  it('does NOT alert on the MacBook seed history (plain drop, no prior rise)', () => {
    const pts = [
      point(1018.98, '2026-10-26T00:00:00Z'),
      point(999, '2026-11-02T00:00:00Z'),
    ];
    const r = detectFakeSale(pts, 90);
    expect(r.alert).toBe(false);
    expect(r.currentPrice).toBe(999);
  });

  it('does NOT alert when the sale price drops below the pre-rise price', () => {
    const pts = [
      point(1000, '2026-08-15T00:00:00Z'),
      point(1150, '2026-09-01T00:00:00Z'),
      point(950, '2026-09-20T00:00:00Z'), // below pre-rise — real deal
    ];
    const r = detectFakeSale(pts, 90);
    expect(r.alert).toBe(false);
  });

  it('does NOT alert on a rise below 10% inside 90 days', () => {
    const pts = [
      point(1000, '2026-08-15T00:00:00Z'),
      point(1050, '2026-09-01T00:00:00Z'), // +5% only
      point(1020, '2026-09-20T00:00:00Z'),
    ];
    const r = detectFakeSale(pts, 90);
    expect(r.alert).toBe(false);
    expect(r.risePct).toBeCloseTo(0.05, 3);
  });

  it('reports not enough history with a single point in the 90-day window', () => {
    const r = detectFakeSale([point(999, '2026-11-02T00:00:00Z')], 90);
    expect(r.alert).toBe(false);
    expect(r.pointsInWindow).toBe(1);
    expect(r.currentPrice).toBe(999);
  });

  it('keeps the 30-day default unchanged', () => {
    const r = detectFakeSale([
      point(1000, '2026-08-15T00:00:00Z'),
      point(1150, '2026-09-01T00:00:00Z'),
      point(1099, '2026-09-20T00:00:00Z'),
    ]);
    expect(r.windowDays).toBe(30);
    // The rise is outside the 30-day window anchored at Sep 20.
    expect(r.alert).toBe(false);
  });
});
