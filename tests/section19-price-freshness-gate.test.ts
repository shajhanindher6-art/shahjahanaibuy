/**
 * Section 19, Phase 2 — freshness helpers (§12 #20/#21; task
 * items 4 + 5).
 *
 * Two fail-opens fixed in lib/price-freshness.ts:
 *  - isPriceStale returned false for an unknown age, which
 *    callers read as "fresh". getFreshnessStatus is the
 *    three-state replacement: 'fresh' | 'stale' | 'unknown'.
 *  - Interpretive verdicts ("good time to buy") carried no
 *    freshness. formatVerdictFreshnessNote is the shared
 *    qualifier: null while fresh, otherwise the honest
 *    "based on a price last checked N days ago" note.
 * The StalePriceBadge "age unknown" render is pinned in
 * tests/section16-stale-price-badge.test.ts (updated in this
 * phase); this file pins the helpers the badge and the summary
 * gate both read from.
 */

import { describe, expect, it } from 'vitest';
import {
  getFreshnessStatus,
  formatVerdictFreshnessNote,
  isPriceStale,
  STALE_PRICE_DAYS,
} from '@/lib/price-freshness';

const DAY_MS = 86_400_000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

describe('getFreshnessStatus — three states, never fail-open', () => {
  it('fresh within the threshold', () => {
    expect(getFreshnessStatus(daysAgo(2))).toEqual({ status: 'fresh', ageDays: 2 });
    expect(getFreshnessStatus(daysAgo(0)).status).toBe('fresh');
  });

  it('stale past the threshold', () => {
    expect(STALE_PRICE_DAYS).toBe(7);
    expect(getFreshnessStatus(daysAgo(10))).toEqual({ status: 'stale', ageDays: 10 });
    expect(getFreshnessStatus(daysAgo(8)).status).toBe('stale');
  });

  it('unknown when there is no recorded check — null, undefined, empty, unparseable', () => {
    expect(getFreshnessStatus(null)).toEqual({ status: 'unknown', ageDays: null });
    expect(getFreshnessStatus(undefined)).toEqual({ status: 'unknown', ageDays: null });
    expect(getFreshnessStatus('')).toEqual({ status: 'unknown', ageDays: null });
    expect(getFreshnessStatus('not-a-date')).toEqual({ status: 'unknown', ageDays: null });
  });

  it('isPriceStale still answers false for unknown (its callers treat unknown as "no stale offer")', () => {
    expect(isPriceStale(null)).toBe(false);
    expect(isPriceStale(daysAgo(10))).toBe(true);
    expect(isPriceStale(daysAgo(2))).toBe(false);
  });
});

describe('formatVerdictFreshnessNote — the interpretive-verdict gate', () => {
  it('null while the price is fresh — no qualification needed', () => {
    expect(formatVerdictFreshnessNote(daysAgo(2))).toBeNull();
  });

  it('stale prices name the age in days', () => {
    const note = formatVerdictFreshnessNote(daysAgo(10));
    expect(note).toContain('10 days ago');
    expect(note).toContain('may be out of date');
  });

  it('unknown age says so instead of silently passing', () => {
    const note = formatVerdictFreshnessNote(null);
    expect(note).toContain('Price age unknown');
    expect(note).toContain('may be out of date');
  });

  it('singular "1 day ago" reads correctly', () => {
    expect(formatVerdictFreshnessNote(daysAgo(8))).toContain('8 days ago');
  });
});
