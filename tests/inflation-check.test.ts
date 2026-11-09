import { describe, it, expect } from 'vitest';
import { checkPriceInflation } from '@/services/inflation-check';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Price point `daysAgo` days before now (0 = latest recorded price). */
function pt(price: number, daysAgo: number) {
  return {
    price,
    recordedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  };
}

describe('checkPriceInflation', () => {
  it('flags a fake-discount pattern: rise 10%+ then a drop, latest not below pre-rise', () => {
    const r = checkPriceInflation([pt(100, 20), pt(115, 10), pt(110, 0)]);
    expect(r.verdict).toBe('fake_discount_pattern');
    expect(r.risePct).toBeCloseTo(0.15, 3);
    expect(r.dropPct).toBeCloseTo((115 - 110) / 115, 3);
    expect(r.earliestPrice).toBe(100);
    expect(r.peakPrice).toBe(115);
    expect(r.currentPrice).toBe(110);
    expect(r.pointCount).toBe(3);
    expect(r.reason).toMatch(/Fake-discount pattern detected/);
    expect(r.reason).not.toMatch(/scam|fraud/i);
  });

  it('flags sustained inflation: steady +15% creep with no drop', () => {
    const r = checkPriceInflation([pt(100, 25), pt(105, 15), pt(110, 5), pt(115, 0)]);
    expect(r.verdict).toBe('inflated');
    expect(r.risePct).toBeCloseTo(0.15, 3);
    expect(r.dropPct).toBe(0);
    expect(r.earliestPrice).toBe(100);
    expect(r.currentPrice).toBe(115);
    expect(r.reason).toMatch(/Sustained price inflation/);
    expect(r.reason).toMatch(/\+15%/);
    expect(r.reason).not.toMatch(/scam|fraud/i);
  });

  it('reports no_pattern for a flat history', () => {
    const r = checkPriceInflation([pt(999, 29), pt(999, 14), pt(999, 7), pt(999, 0)]);
    expect(r.verdict).toBe('no_pattern');
    expect(r.risePct).toBe(0);
    expect(r.reason).toMatch(/No fake-discount or inflation pattern/);
  });

  it('is insufficient with 0 points', () => {
    const r = checkPriceInflation([]);
    expect(r.verdict).toBe('insufficient');
    expect(r.reason).toBe('Not enough price history to check — need at least 2 recorded prices.');
    expect(r.risePct).toBeNull();
    expect(r.currentPrice).toBeNull();
  });

  it('is insufficient with 1 point', () => {
    const r = checkPriceInflation([pt(999, 0)]);
    expect(r.verdict).toBe('insufficient');
    expect(r.pointCount).toBe(0);
  });

  it('flags the fake-discount pattern at exactly a 10% rise (boundary, inclusive)', () => {
    const r = checkPriceInflation([pt(100, 20), pt(110, 10), pt(105, 0)]);
    expect(r.verdict).toBe('fake_discount_pattern');
    expect(r.risePct).toBeCloseTo(0.1, 3);
  });

  it('flags inflation at exactly a +10% rise with the price at its peak (boundary, inclusive)', () => {
    const r = checkPriceInflation([pt(100, 20), pt(110, 0)]);
    expect(r.verdict).toBe('inflated');
    expect(r.risePct).toBeCloseTo(0.1, 3);
  });

  it('does not flag inflation just below +10%', () => {
    const r = checkPriceInflation([pt(100, 20), pt(109.9, 0)]);
    expect(r.verdict).toBe('no_pattern');
  });

  it('does not flag a fake sale when the drop goes below the pre-rise price', () => {
    const r = checkPriceInflation([pt(100, 20), pt(120, 10), pt(90, 0)]);
    expect(r.verdict).toBe('no_pattern');
  });

  it('ignores invalid points (NaN, zero, negative, bad date)', () => {
    const r = checkPriceInflation([
      { price: NaN, recordedAt: new Date().toISOString() },
      { price: 0, recordedAt: new Date().toISOString() },
      { price: -5, recordedAt: new Date().toISOString() },
      { price: 100, recordedAt: 'not-a-date' },
      pt(100, 20),
      pt(115, 10),
      pt(110, 0),
    ]);
    expect(r.verdict).toBe('fake_discount_pattern');
    expect(r.pointCount).toBe(3);
  });

  it('handles unsorted points the same as sorted ones', () => {
    const sorted = checkPriceInflation([pt(100, 20), pt(115, 10), pt(110, 0)]);
    const shuffled = checkPriceInflation([pt(110, 0), pt(100, 20), pt(115, 10)]);
    expect(shuffled.verdict).toBe(sorted.verdict);
    expect(shuffled.risePct).toBe(sorted.risePct);
    expect(shuffled.earliestPrice).toBe(sorted.earliestPrice);
    expect(shuffled.spanDays).toBe(sorted.spanDays);
  });

  it('MacBook seed history (drop, no prior rise) is no_pattern', () => {
    const r = checkPriceInflation([pt(1048.95, 29), pt(1018.98, 14), pt(999, 7), pt(999, 0)]);
    expect(r.verdict).toBe('no_pattern');
    expect(r.risePct).toBeCloseTo((999 - 1048.95) / 1048.95, 3);
  });
});
