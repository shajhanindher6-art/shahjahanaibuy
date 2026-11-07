import { describe, expect, it } from 'vitest';
import { rotateDealsForRegion } from '@/services/deal-rotation';

const DEALS = ['macbook', 'dell', 'sony', 'bose', 'galaxy', 'canon'];

function isRotation<T>(result: T[], input: T[]): boolean {
  if (result.length !== input.length) return false;
  const doubled = [...input, ...input];
  const joined = doubled.join('|');
  return joined.includes(result.join('|'));
}

describe('rotateDealsForRegion', () => {
  it('passes through empty and single-item lists unchanged', () => {
    expect(rotateDealsForRegion([], 'PK', '2026-11-07')).toEqual([]);
    expect(rotateDealsForRegion(['only'], 'PK', '2026-11-07')).toEqual([
      'only',
    ]);
  });

  it('is deterministic for the same region and day', () => {
    const a = rotateDealsForRegion(DEALS, 'PK', '2026-11-07');
    const b = rotateDealsForRegion(DEALS, 'PK', '2026-11-07');
    expect(a).toEqual(b);
  });

  it('only rotates — never adds, removes, or re-ranks a deal', () => {
    for (const region of ['PK', 'US', 'AE', 'IN']) {
      for (const day of ['2026-11-07', '2026-11-08']) {
        const result = rotateDealsForRegion(DEALS, region, day);
        expect(result).toHaveLength(DEALS.length);
        expect([...result].sort()).toEqual([...DEALS].sort());
        expect(isRotation(result, DEALS)).toBe(true);
      }
    }
  });

  it('region is case-insensitive', () => {
    expect(rotateDealsForRegion(DEALS, 'pk', '2026-11-07')).toEqual(
      rotateDealsForRegion(DEALS, 'PK', '2026-11-07')
    );
  });
});
