import { describe, expect, it } from 'vitest';
import {
  ALL_DIRECTORY_STORES,
  describeStoreTrust,
  directoryStoreKey,
  findDirectoryStore,
  parseStoreTrustParams,
} from '@/lib/store-trust-checker';
import { computeTrustGrade } from '@/lib/merchant-trust';

describe('store trust checker directory', () => {
  it('lists all 84 directory stores (80 local + 4 global)', () => {
    expect(ALL_DIRECTORY_STORES).toHaveLength(84);
  });

  it('finds Amazon (GLOBAL) by its slug|country key', () => {
    const store = findDirectoryStore('amazon|GLOBAL');
    expect(store?.name).toBe('Amazon');
    expect(store?.countryCode).toBe('GLOBAL');
  });

  it('distinguishes same-slug stores by country (ebay US vs GLOBAL)', () => {
    const us = findDirectoryStore('ebay|US');
    const global = findDirectoryStore('ebay|GLOBAL');
    expect(us?.countryCode).toBe('US');
    expect(global?.countryCode).toBe('GLOBAL');
    expect(directoryStoreKey(us!)).not.toBe(directoryStoreKey(global!));
  });

  it('returns null for an unknown store key', () => {
    expect(findDirectoryStore('not-a-store|XX')).toBeNull();
    expect(findDirectoryStore(null)).toBeNull();
  });

  it('parses ?store= from the query', () => {
    expect(parseStoreTrustParams({ store: 'daraz|PK' })).toEqual({
      storeKey: 'daraz|PK',
      hasQuery: true,
    });
    expect(parseStoreTrustParams({})).toEqual({ storeKey: null, hasQuery: false });
  });
});

describe('describeStoreTrust', () => {
  it('asks to pick a store when nothing is selected', () => {
    const d = describeStoreTrust({ store: null, storeKey: null, merchantFound: false, grade: null });
    expect(d.status).toBe('no-store-selected');
  });

  it('reports an unknown store honestly', () => {
    const d = describeStoreTrust({ store: null, storeKey: 'nope|XX', merchantFound: false, grade: null });
    expect(d.status).toBe('unknown-store');
  });

  it('reports "Not enough data" for a directory-only store (Daraz has no merchant record)', () => {
    const store = findDirectoryStore('daraz|PK')!;
    const d = describeStoreTrust({ store, storeKey: 'daraz|PK', merchantFound: false, grade: null });
    expect(d.status).toBe('no-merchant-record');
    expect(d.heading).toBe('Not enough data');
  });

  it('reports "Not enough data" for a matched merchant with NULL policy facts', () => {
    const store = findDirectoryStore('amazon|GLOBAL')!;
    const grade = computeTrustGrade({ returnWindowDays: null, warrantyMonths: null, reputationScore: null });
    const d = describeStoreTrust({ store, storeKey: 'amazon|GLOBAL', merchantFound: true, grade });
    expect(d.status).toBe('insufficient-policy');
    expect(d.heading).toBe('Not enough data');
    expect(d.lines.join(' ')).toContain('return window');
  });

  it('shows a grade only when all three policy facts are recorded', () => {
    const store = findDirectoryStore('amazon|GLOBAL')!;
    const grade = computeTrustGrade({ returnWindowDays: 30, warrantyMonths: 24, reputationScore: 4.5 });
    expect(grade.grade).toBe('A');
    expect(grade.score).toBe(97);
    const d = describeStoreTrust({ store, storeKey: 'amazon|GLOBAL', merchantFound: true, grade });
    expect(d.status).toBe('graded');
    expect(d.heading).toBe('Trust grade A');
  });
});
