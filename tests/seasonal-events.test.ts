import { describe, expect, it } from 'vitest';
import { SEASONAL_EVENTS, RECORDED_DEALS, getEventBySlug } from '../components/seasonal/events';

describe('seasonal events', () => {
  it('has exactly three events: Black Friday, 11.11, and Eid', () => {
    expect(SEASONAL_EVENTS.map((e) => e.slug).sort()).toEqual(
      ['11-11', 'black-friday', 'eid'].sort(),
    );
  });

  it('uses verified calendar dates (11.11 and Black Friday 2026)', () => {
    expect(getEventBySlug('11-11')?.startsAt).toBe('2026-11-11T00:00:00Z');
    expect(getEventBySlug('black-friday')?.startsAt).toBe('2026-11-27T00:00:00Z');
    // Black Friday 2026 is a Friday (day after US Thanksgiving, Nov 26).
    expect(new Date('2026-11-27T00:00:00Z').getUTCDay()).toBe(5);
    expect(new Date('2026-11-11T00:00:00Z').getUTCDay()).toBe(3);
  });

  it('labels the Eid date as expected, not confirmed', () => {
    const eid = getEventBySlug('eid');
    expect(eid?.dateExpected).toBe(true);
    expect(eid?.startsAt).toBe('2027-03-20T00:00:00Z');
  });

  it('gives every event a description and tips, with no invented prices', () => {
    for (const event of SEASONAL_EVENTS) {
      expect(event.description.length).toBeGreaterThan(50);
      expect(event.tips.length).toBeGreaterThanOrEqual(3);
      expect(event.description).not.toMatch(/\$\d+ off/i);
    }
  });

  it('returns undefined for unknown slugs', () => {
    expect(getEventBySlug('cyber-monday')).toBeUndefined();
  });

  it('lists only the six recorded demo deals — nothing invented', () => {
    expect(RECORDED_DEALS.length).toBe(6);
    const slugs = RECORDED_DEALS.map((d) => d.productSlug).sort();
    expect(slugs).toEqual(
      [
        'bose-quietcomfort-ultra',
        'canon-eos-r10',
        'dell-xps-13',
        'galaxy-s24-ultra',
        'macbook-air-13',
        'sony-wh-1000xm5',
      ].sort(),
    );
    for (const deal of RECORDED_DEALS) {
      expect(deal.discountValue).toBeGreaterThan(0);
      expect(deal.discountValue).toBeLessThanOrEqual(100);
    }
  });
});
