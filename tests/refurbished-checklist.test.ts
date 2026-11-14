import { describe, expect, it } from 'vitest';
import {
  CONDITION_GRADES,
  INSPECTION_CHECKLIST,
  REFURBISHED_OUTBOUND_NOTE,
  buildRefurbishedBenchmark,
  refurbishedSearchQuery,
} from '@/lib/refurbished-checklist';

describe('CONDITION_GRADES (T9 — general decoder, grades are not standardized)', () => {
  it('decodes exactly grades A, B and C', () => {
    expect(CONDITION_GRADES.map((g) => g.grade)).toEqual(['A', 'B', 'C']);
  });

  it('every grade has a label, a meaning and a watch-out', () => {
    for (const grade of CONDITION_GRADES) {
      expect(grade.label.length).toBeGreaterThan(3);
      expect(grade.meaning.length).toBeGreaterThan(20);
      expect(grade.watchOutFor.length).toBeGreaterThan(20);
    }
  });

  it('never claims a grade for a specific listing', () => {
    const joined = CONDITION_GRADES.map(
      (g) => `${g.meaning} ${g.watchOutFor}`
    ).join(' ');
    expect(joined).not.toMatch(/this listing|this unit|certified by/i);
  });
});

describe('INSPECTION_CHECKLIST (T9 — 10 points)', () => {
  it('has exactly 10 items with unique ids', () => {
    expect(INSPECTION_CHECKLIST).toHaveLength(10);
    const ids = INSPECTION_CHECKLIST.map((i) => i.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('covers battery health, warranty, return window, seller rating and activation lock', () => {
    const ids = INSPECTION_CHECKLIST.map((i) => i.id);
    for (const required of [
      'battery-health',
      'warranty',
      'return-window',
      'seller-rating',
      'activation-lock',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('every item has a title and a detail', () => {
    for (const item of INSPECTION_CHECKLIST) {
      expect(item.title.length).toBeGreaterThan(3);
      expect(item.detail.length).toBeGreaterThan(20);
    }
  });

  it('the price item compares against the recorded NEW price only', () => {
    const priceItem = INSPECTION_CHECKLIST.find((i) => i.id === 'price-vs-new');
    expect(priceItem?.detail).toMatch(/recorded new price/);
    expect(priceItem?.detail).not.toMatch(/refurbished price is/i);
  });
});

describe('buildRefurbishedBenchmark', () => {
  it('builds a benchmark from the lowest recorded new price', () => {
    const benchmark = buildRefurbishedBenchmark({
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      recordedPrice: 999,
      priceState: {
        state: 'STALE',
        label: 'Stale',
        reason: 'Recorded price is more than 7 days old.',
      },
      lastCheckedAt: '2026-11-02T00:00:00.000Z',
    });
    expect(benchmark.hasRecordedPrice).toBe(true);
    expect(benchmark.recordedPrice).toBe(999);
    expect(benchmark.priceStateLabel).toBe('Stale');
    expect(benchmark.lastCheckedLabel).toBe('Nov 2, 2026');
  });

  it('a stale benchmark keeps its STALE label — never dressed up as current', () => {
    const benchmark = buildRefurbishedBenchmark({
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      recordedPrice: 999,
      priceState: {
        state: 'STALE',
        label: 'Stale',
        reason: 'Recorded price is more than 7 days old.',
      },
      lastCheckedAt: '2026-11-02T00:00:00.000Z',
    });
    expect(benchmark.priceStateLabel).not.toBe('Live verified');
  });

  it('no recorded price → no benchmark, no invented number', () => {
    const benchmark = buildRefurbishedBenchmark({
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      recordedPrice: null,
      priceState: null,
      lastCheckedAt: null,
    });
    expect(benchmark.hasRecordedPrice).toBe(false);
    expect(benchmark.recordedPrice).toBeNull();
    expect(benchmark.priceStateLabel).toBeNull();
    expect(benchmark.lastCheckedLabel).toBeNull();
  });

  it('a non-finite price is treated as no recorded price', () => {
    const benchmark = buildRefurbishedBenchmark({
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      recordedPrice: Number.NaN,
      priceState: null,
      lastCheckedAt: null,
    });
    expect(benchmark.hasRecordedPrice).toBe(false);
    expect(benchmark.recordedPrice).toBeNull();
  });

  it('a live-verified benchmark keeps its label when the data supports it', () => {
    const benchmark = buildRefurbishedBenchmark({
      name: 'MacBook Air 13',
      slug: 'macbook-air-13',
      recordedPrice: 899,
      priceState: {
        state: 'LIVE_VERIFIED',
        label: 'Live verified',
        reason: 'Verified live just now.',
      },
      lastCheckedAt: '2026-11-14T00:00:00.000Z',
    });
    expect(benchmark.priceStateLabel).toBe('Live verified');
  });
});

describe('refurbishedSearchQuery', () => {
  it('prefixes the product name with "refurbished"', () => {
    expect(refurbishedSearchQuery('MacBook Air 13')).toBe(
      'refurbished MacBook Air 13'
    );
    expect(refurbishedSearchQuery('  Sony WH-1000XM5  ')).toBe(
      'refurbished Sony WH-1000XM5'
    );
  });
});

describe('REFURBISHED_OUTBOUND_NOTE', () => {
  it('states plainly that no refurbished offer or price is shown', () => {
    expect(REFURBISHED_OUTBOUND_NOTE).toMatch(
      /records no refurbished listings/
    );
    expect(REFURBISHED_OUTBOUND_NOTE).toMatch(/no refurbished offer or price/);
  });
});
