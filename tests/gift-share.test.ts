import { describe, expect, it } from 'vitest';
import { buildGiftShareUrl, parseGiftShareParams } from '../lib/gift-share';

const OCCASIONS = ['Birthday', 'Anniversary', 'Wedding', 'Graduation', 'New home', 'Thank you', 'Holiday', 'Just because'];
const COUNTRIES = ['US', 'PK', 'GB'];

describe('gift share URL', () => {
  it('builds a URL carrying all four inputs', () => {
    const url = buildGiftShareUrl('https://example.com/', {
      occasion: 'Birthday',
      budgetText: 'under $500',
      country: 'PK',
      interests: 'headphones, fitness',
    });
    expect(url).toBe(
      'https://example.com/gifts?occasion=Birthday&budget=under+%24500&country=PK&interests=headphones%2C+fitness',
    );
  });

  it('omits empty inputs and returns the bare page URL when nothing is set', () => {
    expect(buildGiftShareUrl('https://example.com', {})).toBe('https://example.com/gifts');
    expect(buildGiftShareUrl('https://example.com', { occasion: 'Wedding' })).toBe(
      'https://example.com/gifts?occasion=Wedding',
    );
  });

  it('round-trips through parse', () => {
    const params = {
      occasion: 'Graduation',
      budgetText: 'under 20K PKR',
      country: 'PK',
      interests: 'photography',
    };
    const url = buildGiftShareUrl('https://example.com', params);
    expect(parseGiftShareParams(new URL(url).search, OCCASIONS, COUNTRIES)).toEqual(params);
  });

  it('drops an occasion or country outside the picker options instead of guessing', () => {
    const parsed = parseGiftShareParams(
      '?occasion=Retirement&budget=under+%24500&country=XX&interests=headphones',
      OCCASIONS,
      COUNTRIES,
    );
    expect(parsed).toEqual({ budgetText: 'under $500', interests: 'headphones' });
  });

  it('drops blank or over-long budget and interests text', () => {
    const parsed = parseGiftShareParams(
      `?budget=%20%20&interests=${'x'.repeat(501)}`,
      OCCASIONS,
      COUNTRIES,
    );
    expect(parsed).toEqual({});
  });

  it('never throws on an unparseable query string', () => {
    expect(() => parseGiftShareParams('?%E0%A4%A', OCCASIONS, COUNTRIES)).not.toThrow();
  });
});
