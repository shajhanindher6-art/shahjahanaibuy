import { describe, expect, it } from 'vitest';
import { SEASONAL_EVENTS, RECORDED_DEALS, getEventBySlug } from '../components/seasonal/events';

describe('seasonal events', () => {
  it('has exactly five events: Black Friday, Cyber Monday, 11.11, Eid al-Fitr, and Eid al-Adha', () => {
    expect(SEASONAL_EVENTS.map((e) => e.slug).sort()).toEqual(
      ['11-11', 'black-friday', 'cyber-monday', 'eid', 'eid-al-adha'].sort(),
    );
  });

  it('uses verified calendar dates (11.11, Black Friday and Cyber Monday 2026)', () => {
    expect(getEventBySlug('11-11')?.startsAt).toBe('2026-11-11T00:00:00Z');
    expect(getEventBySlug('black-friday')?.startsAt).toBe('2026-11-27T00:00:00Z');
    expect(getEventBySlug('cyber-monday')?.startsAt).toBe('2026-11-30T00:00:00Z');
    // Black Friday 2026 is a Friday (day after US Thanksgiving, Nov 26);
    // Cyber Monday is the following Monday.
    expect(new Date('2026-11-27T00:00:00Z').getUTCDay()).toBe(5);
    expect(new Date('2026-11-30T00:00:00Z').getUTCDay()).toBe(1);
    expect(new Date('2026-11-11T00:00:00Z').getUTCDay()).toBe(3);
  });

  it('labels the Eid dates as expected, not confirmed', () => {
    const eid = getEventBySlug('eid');
    expect(eid?.dateExpected).toBe(true);
    // Eid al-Fitr 2027: expected Tuesday, March 9 (Umm al-Qura / FCNA
    // calculated calendars; March 10 where a local sighting runs long).
    // The old 2027-03-20 date was Eid al-Fitr 2026's date, not 2027's.
    expect(eid?.startsAt).toBe('2027-03-09T00:00:00Z');
    const adha = getEventBySlug('eid-al-adha');
    expect(adha?.dateExpected).toBe(true);
    // Eid al-Adha 2027: expected Sunday, May 16 (10 Dhu al-Hijjah 1448);
    // Pakistan / local-sighting countries may observe Monday, May 17.
    expect(adha?.startsAt).toBe('2027-05-16T00:00:00Z');
    expect(new Date('2027-05-16T00:00:00Z').getUTCDay()).toBe(0);
  });

  it('gives every event a description and tips, with no invented prices', () => {
    for (const event of SEASONAL_EVENTS) {
      expect(event.description.length).toBeGreaterThan(50);
      expect(event.tips.length).toBeGreaterThanOrEqual(3);
      expect(event.description).not.toMatch(/\$\d+ off/i);
    }
  });

  it('returns undefined for unknown slugs', () => {
    expect(getEventBySlug('boxing-day')).toBeUndefined();
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
