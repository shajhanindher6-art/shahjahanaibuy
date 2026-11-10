import { describe, expect, it } from 'vitest';
import { geoSourceLabel, resolveServerCountry } from '@/lib/platform-geo';

// Section 8 — server country resolution: Vercel geo header (IP)
// first, then the saved sb-country cookie, then the US fallback.
// An invalid or unknown code never propagates.

describe('resolveServerCountry', () => {
  it('uses the geo header first (IP detection)', () => {
    expect(
      resolveServerCountry({ headerCountry: 'PK', cookieCountry: 'US' })
    ).toEqual({
      countryCode: 'PK',
      source: 'ip',
      detectedCountryCode: 'PK',
    });
  });

  it('falls back to the saved cookie when the header is missing', () => {
    expect(
      resolveServerCountry({ headerCountry: null, cookieCountry: 'PK' })
    ).toEqual({
      countryCode: 'PK',
      source: 'saved',
      detectedCountryCode: 'PK',
    });
  });

  it('ignores an invalid header code and uses the cookie instead', () => {
    expect(
      resolveServerCountry({ headerCountry: 'XX', cookieCountry: 'DE' })
    ).toEqual({
      countryCode: 'DE',
      source: 'saved',
      detectedCountryCode: 'DE',
    });
  });

  it('falls back to US with source fallback when nothing resolves', () => {
    expect(resolveServerCountry({})).toEqual({
      countryCode: 'US',
      source: 'fallback',
      detectedCountryCode: null,
    });
    expect(
      resolveServerCountry({ headerCountry: 'XX', cookieCountry: 'YY' })
    ).toEqual({
      countryCode: 'US',
      source: 'fallback',
      detectedCountryCode: null,
    });
  });

  it('normalises lowercase codes', () => {
    expect(resolveServerCountry({ headerCountry: 'pk' })).toEqual({
      countryCode: 'PK',
      source: 'ip',
      detectedCountryCode: 'PK',
    });
  });
});

describe('geoSourceLabel', () => {
  it('labels each source honestly', () => {
    expect(geoSourceLabel('ip', 'Pakistan')).toContain('Detected');
    expect(geoSourceLabel('saved', 'Pakistan')).toContain('saved country');
    expect(geoSourceLabel('fallback', 'Pakistan')).toContain(
      'could not be detected'
    );
  });
});
