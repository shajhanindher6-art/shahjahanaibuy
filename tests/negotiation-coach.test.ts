import { describe, expect, it } from 'vitest';
import { parseNegotiationCoachParams } from '@/lib/negotiation-coach';
import {
  analyzeNegotiationGap,
  buildNegotiationDraft,
  type PricePoint,
} from '@/services/negotiation';

const HISTORY: PricePoint[] = [
  { price: 999, recordedAt: '2026-10-05T00:00:00.000Z' },
  { price: 949, recordedAt: '2026-10-15T00:00:00.000Z' },
  { price: 899, recordedAt: '2026-10-26T00:00:00.000Z' },
  { price: 929, recordedAt: '2026-11-02T00:00:00.000Z' },
];

describe('parseNegotiationCoachParams', () => {
  it('parses product + target + reason, trimming the reason', () => {
    expect(
      parseNegotiationCoachParams({
        product: 'macbook-air-13',
        target: '899',
        reason: '  buying for a student budget  ',
      })
    ).toEqual({
      productSlug: 'macbook-air-13',
      targetUsd: 899,
      reason: 'buying for a student budget',
      error: null,
    });
  });

  it('treats a missing target as no query yet, not an error', () => {
    expect(parseNegotiationCoachParams({ product: 'macbook-air-13' })).toEqual({
      productSlug: 'macbook-air-13',
      targetUsd: null,
      reason: null,
      error: null,
    });
  });

  it('rejects a zero, negative, or non-numeric target', () => {
    for (const target of ['0', '-50', 'abc', '']) {
      const parsed = parseNegotiationCoachParams({ product: 'macbook-air-13', target });
      if (target === '') {
        expect(parsed.error).toBeNull();
        expect(parsed.targetUsd).toBeNull();
      } else {
        expect(parsed.targetUsd).toBeNull();
        expect(parsed.error).toMatch(/above \$0/);
      }
    }
  });

  it('caps an over-long reason instead of rejecting the query', () => {
    const parsed = parseNegotiationCoachParams({
      product: 'macbook-air-13',
      target: '899',
      reason: 'x'.repeat(600),
    });
    expect(parsed.error).toBeNull();
    expect(parsed.reason?.length).toBe(500);
  });

  it('takes the first value of a repeated param', () => {
    expect(parseNegotiationCoachParams({ product: ['a', 'b'] }).productSlug).toBe('a');
  });
});

describe('analyzeNegotiationGap (engine, via the coach)', () => {
  it('computes the gap vs the cheapest price and the recorded low', () => {
    const gap = analyzeNegotiationGap(929, HISTORY, 899);
    expect(gap).not.toBeNull();
    expect(gap?.currentCheapestUsd).toBe(929);
    expect(gap?.lowestRecordedUsd).toBe(899);
    expect(gap?.averageRecordedUsd).toBe(944);
    expect(gap?.pointsUsed).toBe(4);
    expect(gap?.gapVsCurrentUsd).toBe(-30);
    expect(gap?.belowEveryRecordedPrice).toBe(false);
    expect(gap?.alreadyMet).toBe(false);
  });

  it('flags a target below every recorded price instead of dressing it up', () => {
    const gap = analyzeNegotiationGap(929, HISTORY, 799);
    expect(gap?.belowEveryRecordedPrice).toBe(true);
    expect(gap?.alreadyMet).toBe(false);
    expect(gap?.gapVsCurrentUsd).toBe(-130);
  });

  it('reports already-met when the target is at or above the cheapest price', () => {
    const gap = analyzeNegotiationGap(929, HISTORY, 929);
    expect(gap?.alreadyMet).toBe(true);
    expect(gap?.belowEveryRecordedPrice).toBe(false);
    const above = analyzeNegotiationGap(929, HISTORY, 999);
    expect(above?.alreadyMet).toBe(true);
  });

  it('works with no recorded history (lowest/average null, gap still computed)', () => {
    const gap = analyzeNegotiationGap(929, [], 899);
    expect(gap?.lowestRecordedUsd).toBeNull();
    expect(gap?.averageRecordedUsd).toBeNull();
    expect(gap?.pointsUsed).toBe(0);
    expect(gap?.belowEveryRecordedPrice).toBe(false);
    expect(gap?.gapVsCurrentUsd).toBe(-30);
  });

  it('works with no cheapest price (gap null, history still reported)', () => {
    const gap = analyzeNegotiationGap(null, HISTORY, 899);
    expect(gap?.currentCheapestUsd).toBeNull();
    expect(gap?.gapVsCurrentUsd).toBeNull();
    expect(gap?.lowestRecordedUsd).toBe(899);
  });

  it('returns null for an invalid target — never a fabricated analysis', () => {
    expect(analyzeNegotiationGap(929, HISTORY, 0)).toBeNull();
    expect(analyzeNegotiationGap(929, HISTORY, -10)).toBeNull();
    expect(analyzeNegotiationGap(929, HISTORY, Number.NaN)).toBeNull();
  });
});

describe('buildNegotiationDraft (engine, via the coach)', () => {
  it('drafts a polite ask stating only facts — no coupon, no hidden price, no promise', () => {
    const gap = analyzeNegotiationGap(929, HISTORY, 899);
    expect(gap).not.toBeNull();
    const draft = buildNegotiationDraft({ productName: 'MacBook Air 13', gap: gap! });
    expect(draft).toContain('MacBook Air 13');
    expect(draft).toContain('$899.00');
    expect(draft).toContain('$929.00');
    expect(draft.toLowerCase()).not.toContain('coupon');
    expect(draft.toLowerCase()).not.toContain('hidden');
    expect(draft.toLowerCase()).not.toContain('negotiat');
    expect(draft).toContain('No worries at all if that');
  });

  it('mentions the recorded low only when the target is within the recorded range', () => {
    const inRange = analyzeNegotiationGap(929, HISTORY, 899);
    const belowAll = analyzeNegotiationGap(929, HISTORY, 799);
    expect(buildNegotiationDraft({ productName: 'MacBook Air 13', gap: inRange! })).toContain(
      '$899.00'
    );
    // Below every recorded price, the draft must not cite a
    // "seen it around" low the target never reached.
    expect(buildNegotiationDraft({ productName: 'MacBook Air 13', gap: belowAll! })).not.toContain(
      'seen it around'
    );
  });

  it('includes the user’s own reason verbatim when given, and nothing invented when absent', () => {
    const gap = analyzeNegotiationGap(929, HISTORY, 899);
    const withReason = buildNegotiationDraft({
      productName: 'MacBook Air 13',
      gap: gap!,
      reason: 'buying for a student budget',
    });
    expect(withReason).toContain('buying for a student budget');
    const withoutReason = buildNegotiationDraft({ productName: 'MacBook Air 13', gap: gap! });
    expect(withoutReason).not.toContain('For context');
  });
});
