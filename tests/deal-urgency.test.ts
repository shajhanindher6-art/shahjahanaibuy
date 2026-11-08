import { describe, expect, it } from 'vitest';
import { DEAL_URGENCY_THRESHOLDS, getDealUrgency } from '@/services/deal-urgency';

const NOW = new Date('2026-11-08T12:00:00Z');

function hoursFromNow(h: number): string {
  return new Date(NOW.getTime() + h * 3600 * 1000).toISOString();
}

const BASE = { inStock: true, now: NOW };

describe('getDealUrgency — end-time boundaries', () => {
  it('24h left is high, 25h is medium, 72h is medium, 73h is low, 168h is low, 169h is none', () => {
    expect(getDealUrgency({ ...BASE, endsAt: hoursFromNow(24) }).level).toBe('high');
    expect(getDealUrgency({ ...BASE, endsAt: hoursFromNow(25) }).level).toBe('medium');
    expect(getDealUrgency({ ...BASE, endsAt: hoursFromNow(72) }).level).toBe('medium');
    expect(getDealUrgency({ ...BASE, endsAt: hoursFromNow(73) }).level).toBe('low');
    expect(getDealUrgency({ ...BASE, endsAt: hoursFromNow(168) }).level).toBe('low');
    expect(getDealUrgency({ ...BASE, endsAt: hoursFromNow(169) }).level).toBe('none');
  });

  it('an expired end time and an invalid date are no signal', () => {
    expect(getDealUrgency({ ...BASE, endsAt: hoursFromNow(-1) }).level).toBe('none');
    expect(getDealUrgency({ ...BASE, endsAt: 'not-a-date' }).level).toBe('none');
    expect(getDealUrgency({ ...BASE, endsAt: null }).level).toBe('none');
  });

  it('uses the caller’s end label in the reason', () => {
    const result = getDealUrgency({
      ...BASE,
      endsAt: hoursFromNow(18),
      endLabel: 'Coupon expires',
    });
    expect(result.level).toBe('high');
    expect(result.reasons[0]).toContain('Coupon expires in 18h');
  });
});

describe('getDealUrgency — stock boundaries', () => {
  it('3 left is high, 4 and 10 are medium, 11 is none, unknown is none', () => {
    expect(getDealUrgency({ ...BASE, stockQuantity: 3 }).level).toBe('high');
    expect(getDealUrgency({ ...BASE, stockQuantity: 4 }).level).toBe('medium');
    expect(getDealUrgency({ ...BASE, stockQuantity: 10 }).level).toBe('medium');
    expect(getDealUrgency({ ...BASE, stockQuantity: 11 }).level).toBe('none');
    expect(getDealUrgency({ ...BASE, stockQuantity: null }).level).toBe('none');
  });

  it('names the stock count in the reason', () => {
    const result = getDealUrgency({ ...BASE, stockQuantity: 2 });
    expect(result.reasons).toEqual(['Only 2 left in stock']);
  });
});

describe('getDealUrgency — drop boundaries', () => {
  it('20% is high, 19.9% and 10% are medium, 9.9% is low, 0% is none', () => {
    expect(getDealUrgency({ ...BASE, dropPercent: 20 }).level).toBe('high');
    expect(getDealUrgency({ ...BASE, dropPercent: 19.9 }).level).toBe('medium');
    expect(getDealUrgency({ ...BASE, dropPercent: 10 }).level).toBe('medium');
    expect(getDealUrgency({ ...BASE, dropPercent: 9.9 }).level).toBe('low');
    expect(getDealUrgency({ ...BASE, dropPercent: 0 }).level).toBe('none');
    expect(getDealUrgency({ ...BASE, dropPercent: null }).level).toBe('none');
  });

  it('ignores negative and NaN drops', () => {
    expect(getDealUrgency({ ...BASE, dropPercent: -5 }).level).toBe('none');
    expect(getDealUrgency({ ...BASE, dropPercent: Number.NaN }).level).toBe('none');
  });
});

describe('getDealUrgency — combinations and guardrails', () => {
  it('the highest firing signal wins and all high reasons are listed', () => {
    const result = getDealUrgency({
      ...BASE,
      endsAt: hoursFromNow(48),
      stockQuantity: 2,
      dropPercent: 25,
    });
    expect(result.level).toBe('high');
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons.join(' ')).toContain('Only 2 left in stock');
    expect(result.reasons.join(' ')).toContain('25% below compare-at price');
  });

  it('out of stock is always none, even with every other signal firing', () => {
    expect(
      getDealUrgency({
        inStock: false,
        now: NOW,
        endsAt: hoursFromNow(1),
        stockQuantity: 1,
        dropPercent: 50,
      })
    ).toEqual({ level: 'none', reasons: [] });
  });

  it('no signal at all is none with no reasons', () => {
    expect(getDealUrgency({ ...BASE })).toEqual({ level: 'none', reasons: [] });
  });

  it('threshold constants are the documented values', () => {
    expect(DEAL_URGENCY_THRESHOLDS).toMatchObject({
      highHoursLeft: 24,
      mediumHoursLeft: 72,
      lowHoursLeft: 168,
      highStockAtMost: 3,
      mediumStockAtMost: 10,
      highDropPercent: 20,
      mediumDropPercent: 10,
    });
  });
});
