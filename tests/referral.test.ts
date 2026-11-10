import { describe, expect, it } from 'vitest';
import {
  isValidReferralCode,
  parseReferralCode,
  parseReferralCodeFromSearch,
  buildReferralUrl,
} from '@/lib/referral';

// S3#10 — referral links: random `sb-` codes, never personal data,
// clicks tracked without IP or user agent (migration 026).

describe('isValidReferralCode', () => {
  it('accepts issued codes and rejects anything else', () => {
    expect(isValidReferralCode('sb-abc123def4')).toBe(true);
    expect(isValidReferralCode('sb-abcdefghij')).toBe(true);
    expect(isValidReferralCode('sb-ABC123DEF4')).toBe(false);
    expect(isValidReferralCode('sb-abc123')).toBe(false);
    expect(isValidReferralCode('sb-abc123def45')).toBe(false);
    expect(isValidReferralCode('abc123def4')).toBe(false);
    expect(isValidReferralCode('')).toBe(false);
    expect(isValidReferralCode(null)).toBe(false);
    expect(isValidReferralCode(undefined)).toBe(false);
    expect(isValidReferralCode(123)).toBe(false);
  });
});

describe('parseReferralCode', () => {
  it('normalises a raw query value and rejects bad ones', () => {
    expect(parseReferralCode('sb-abc123def4')).toBe('sb-abc123def4');
    expect(parseReferralCode('  SB-ABC123DEF4  ')).toBe('sb-abc123def4');
    expect(parseReferralCode('not-a-code')).toBeNull();
    expect(parseReferralCode(null)).toBeNull();
  });
});

describe('parseReferralCodeFromSearch', () => {
  it('reads ?ref= from a query string', () => {
    expect(parseReferralCodeFromSearch('?ref=sb-abc123def4')).toBe('sb-abc123def4');
    expect(parseReferralCodeFromSearch('?ref=sb-abc123def4&utm_source=x')).toBe('sb-abc123def4');
    expect(parseReferralCodeFromSearch('ref=sb-abc123def4')).toBe('sb-abc123def4');
  });

  it('returns null when there is no valid ref param', () => {
    expect(parseReferralCodeFromSearch('')).toBeNull();
    expect(parseReferralCodeFromSearch('?ref=bogus')).toBeNull();
    expect(parseReferralCodeFromSearch('?utm_source=x')).toBeNull();
  });
});

describe('buildReferralUrl', () => {
  it('builds a shareable URL with the ref param', () => {
    expect(buildReferralUrl('sb-abc123def4', 'https://shahjahanaibuy-b1zp.vercel.app')).toBe(
      'https://shahjahanaibuy-b1zp.vercel.app/?ref=sb-abc123def4'
    );
    expect(buildReferralUrl('sb-abc123def4', 'https://example.com/')).toBe(
      'https://example.com/?ref=sb-abc123def4'
    );
  });
});
