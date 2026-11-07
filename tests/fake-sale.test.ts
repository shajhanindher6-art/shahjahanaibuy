import { describe, expect, it } from 'vitest';
import { detectFakeSale, type FakeSalePoint } from '@/services/fake-sale';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function point(price: number, daysAgo: number): FakeSalePoint {
  return { price, recordedAt: new Date(now - daysAgo * DAY).toISOString() };
}

describe('detectFakeSale', () => {
  it('MacBook negative: a plain drop with no prior rise never alerts', () => {
    // The mandatory negative test from the module docs:
    // $1,018.98 → $999.00 is a drop, not a fake sale.
    const result = detectFakeSale([point(1018.98, 14), point(999, 0)]);
    expect(result.alert).toBe(false);
    expect(result.currentPrice).toBe(999);
  });

  it('alerts on rise ≥10% then a drop that stays above the pre-rise price', () => {
    // 900 → 1100 (+22%) → 1000. Latest is above the pre-rise 900,
    // so the "discount" is only vs the raised price.
    const result = detectFakeSale([
      point(900, 10),
      point(1100, 5),
      point(1000, 0),
    ]);
    expect(result.alert).toBe(true);
    expect(result.preRisePrice).toBe(900);
    expect(result.peakPrice).toBe(1100);
    expect(result.currentPrice).toBe(1000);
  });

  it('does not alert when the latest price falls below the pre-rise price', () => {
    // 900 → 1100 → 850: a real drop below where shoppers started.
    const result = detectFakeSale([
      point(900, 10),
      point(1100, 5),
      point(850, 0),
    ]);
    expect(result.alert).toBe(false);
  });

  it('does not alert on a rise below the 10% threshold', () => {
    // 1000 → 1050 (+5%) → 1020.
    const result = detectFakeSale([
      point(1000, 10),
      point(1050, 5),
      point(1020, 0),
    ]);
    expect(result.alert).toBe(false);
  });

  it('reports not enough history with fewer than 2 points in the window', () => {
    const result = detectFakeSale([point(999, 0)]);
    expect(result.alert).toBe(false);
    expect(result.pointsInWindow).toBe(1);
    expect(detectFakeSale([]).alert).toBe(false);
  });
});
